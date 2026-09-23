/**
 * `ApiClient` port + fixture/HTTP implementations (M3-T1, extended M3-T2,
 * M3-T3, M3-T4a).
 *
 * Only `@smart-kitchen/contracts` DTOs cross this boundary (M3-T1 invariant:
 * `apps/mobile` never imports `@smart-kitchen/domain`). `packages/adapters`
 * is no longer a dependency of this app either (M3-T3 cleanup: nothing here
 * has imported it since M3-T2 moved the fixture inventory rows onto
 * contracts-shaped literals; the dependency and its tsconfig project
 * reference are removed in this ticket, discharging the M2-T1 review's
 * `expo export` bundling blocker for good).
 *
 * ## Read vs write, fixture vs HTTP (M3-T3, extended M3-T4a)
 *
 * `HttpApiClient` implements every inventory read and write M2-T1/M2-T2
 * supply over real `fetch`, used when `EXPO_PUBLIC_API_URL` is set
 * (`src/config/env.ts`, the one file allowed to read it) and never
 * otherwise (BACKLOG.md M3-T3 Objective (d)): the list
 * (`getInventoryItems`, `GET /v1/inventory/items`), the detail-with-history
 * read (`getInventoryItem`, `GET /v1/inventory/items/{id}`), corrections and
 * removals (`correctQuantity`/`removeQuantity`,
 * `POST /v1/inventory/items/{id}/transactions`) and undo
 * (`POST .../{transactionId}/undo`). Onboarding/household state and
 * `confirmAiProposal` have no endpoint yet (M2-T3, later), so `HttpApiClient`
 * still delegates those to an internal fixture client
 * (`FixtureApiClient.returningUser()`) rather than leaving them unimplemented
 * dead ends. This composition, and its scope, is flagged for the reviewer in
 * the worker report.
 *
 * ## Idempotency keys and retries (M3-T4a)
 *
 * Every write/undo call mints exactly one key (`nextIdempotencyKey`,
 * `./idempotency`) and sends it once per *user action*: the key is minted
 * before the first network attempt and reused, unchanged, on this method's
 * own internal retry of a genuine network failure (see `writeWithRetry`
 * below) — never re-minted, and never exposed as a reason to retry a
 * request the server actually answered. A well-formed refusal (a 4xx/409
 * with a coded body) is never retried: the ledger already decided, and
 * retrying it would not change that decision, only duplicate the log noise.
 */

import type {
  ApiErrorBodyDto,
  CreateItemRequestDto,
  HouseholdDto,
  InventoryItemDetailDto,
  InventoryItemsResponseDto,
  InventoryItemSummaryDto,
  InventoryWriteRequestDto,
  InventoryWriteResponseDto,
  MemberDto,
  MemberRestrictionDto,
  OnboardingStateDto,
  ProductLookupResultDto,
  TransactionActorDto,
  UndoRequestDto,
} from "@smart-kitchen/contracts";
import {
  INVENTORY_ITEMS_PATH,
  inventoryItemPath,
  inventoryItemTransactionsPath,
  inventoryTransactionUndoPath,
} from "@smart-kitchen/contracts";
import { getApiBaseUrl } from "../config/env";
import { fixtureChenMembers } from "../household/fixture-restrictions";
import { buildChenInventory } from "../inventory/fixture-household";
import type { RemovalAction } from "../inventory/transactions";
import {
  appendCorrection,
  appendRemoval,
  appendUndo,
  createFixtureItem,
  nextFixtureItemId,
  toDetailDto,
  toSummaryDto,
  type MutableItemFixture,
} from "../inventory/ledger";
import { LedgerRefusedError } from "../inventory/errors";
import { microsToAmountText, parseMicros } from "../inventory/quantity";
import { fixtureLookupProduct } from "../scan/fixture-products";
import { decimalAmountToMicros } from "../scan/quantity";
import { nextIdempotencyKey } from "./idempotency";

/** The Dean-Chen fixture token (tests/fixtures/identity/README.md). Obviously fake, not a secret. */
export const FIXTURE_IDENTITY_TOKEN = "fixture.dean.chen";

/** The one join code the fixture accepts (tests/fixtures/identity/README.md, BACKLOG.md M3-T2). */
export const FIXTURE_JOIN_CODE = "CHEN-482";

/** Exact copy for a join code that does not match (BACKLOG.md M3-T2 Objective (a)). */
export const JOIN_CODE_ERROR_MESSAGE =
  "That code didn't match a household. Check it with whoever invited you.";

const CHEN_HOUSEHOLD_ID = "hh-fixture-chen";

/** The one household member this fixture ever writes ledger rows as (D-022: fixture identity throughout). */
const DEAN_ACTOR: TransactionActorDto = { kind: "user", displayInitials: "DC" };

function freshMember(memberId: string, displayName: string, role: "owner" | "member"): MemberDto {
  return {
    memberId,
    displayName,
    role,
    restrictions: [],
    noneConfirmed: false,
    preferences: [],
  };
}

/**
 * Every create/join path lands on the same two-person Chen fixture household
 * (Dean owner, Maya member), matching the identity fixture
 * (tests/fixtures/identity/README.md) this client already signs in as. There
 * is no real invitation system yet (out of scope: "invites"), so a
 * user-chosen name is honoured but the membership is always this fixture
 * pair — both members start with an unfinished S2 gate (no restrictions, none
 * not confirmed), which is what drives S2's multi-member acceptance criteria.
 */
function buildFixtureHousehold(name: string): HouseholdDto {
  return {
    householdId: CHEN_HOUSEHOLD_ID,
    name,
    members: [
      freshMember("member-dean", "Dean Chen", "owner"),
      freshMember("member-maya", "Maya Chen", "member"),
    ],
  };
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

/**
 * Runtime shape check for `GET /v1/inventory/items`'s body (review F15): a
 * `JSON.parse` result is `unknown`, not `InventoryItemsResponseDto`, no
 * matter what a type assertion claims, and a network layer can hand back
 * anything (an error page, a differently-shaped envelope, a proxy's HTML).
 * Deliberately shallow: this checks `items` is an array, not that every
 * element is a well-formed `InventoryItemSummaryDto` (out of this ticket's
 * scope; a schema-validation layer is a separate concern).
 */
function isInventoryItemsResponse(body: unknown): body is InventoryItemsResponseDto {
  return (
    typeof body === "object" && body !== null && Array.isArray((body as { items?: unknown }).items)
  );
}

/** Same shallow-shape-guard rule as {@link isInventoryItemsResponse}, for `GET /v1/inventory/items/{id}`. */
function isInventoryItemDetailResponse(body: unknown): body is InventoryItemDetailDto {
  if (typeof body !== "object" || body === null) {
    return false;
  }
  const candidate = body as { summary?: unknown; history?: unknown };
  return (
    typeof candidate.summary === "object" &&
    candidate.summary !== null &&
    Array.isArray(candidate.history)
  );
}

/** Same shallow-shape-guard rule, for the write/undo endpoints' shared response shape. */
function isInventoryWriteResponse(body: unknown): body is InventoryWriteResponseDto {
  if (typeof body !== "object" || body === null) {
    return false;
  }
  const candidate = body as { transactions?: unknown; item?: unknown; replayed?: unknown };
  return (
    Array.isArray(candidate.transactions) &&
    typeof candidate.item === "object" &&
    candidate.item !== null &&
    typeof candidate.replayed === "boolean"
  );
}

/**
 * Pulls the code a refused write's body carries: `ledgerCode` when present
 * (a coded `LedgerErrorCodeDto` refusal, including the 409 conflict path,
 * whose `ledgerCode` is `IDEMPOTENCY_KEY_CONFLICT`), else the top-level
 * `ApiErrorCode` (`NOT_FOUND`, `UNDO_NOT_POSSIBLE`, …). `undefined` for a
 * body that does not even look like `ApiErrorBodyDto` (a proxy error page,
 * an empty body) — `ledgerErrorMessage` renders that as the generic
 * fallback, never a guess.
 */
function extractErrorCode(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) {
    return undefined;
  }
  const errorField = (body as { error?: unknown }).error;
  if (typeof errorField !== "object" || errorField === null) {
    return undefined;
  }
  const { ledgerCode, code } = errorField as ApiErrorBodyDto["error"];
  if (typeof ledgerCode === "string") {
    return ledgerCode;
  }
  return typeof code === "string" ? code : undefined;
}

export type JoinHouseholdResult =
  | { readonly ok: true; readonly household: HouseholdDto }
  | { readonly ok: false; readonly message: string };

/** `removeQuantity`'s `action` (copy-deck.md §5), re-exported so a screen can import it from either module. */
export type { RemovalAction };

/** Re-exported so a screen can tell a zero-delta correction apart from any other rejection (review F3). */
export { ZeroDeltaError } from "../inventory/ledger";

/**
 * The seam between the mobile app and the API (M2-T1 onward). Everything the
 * client needs from the network goes through this port so a screen never
 * calls `fetch`/`axios` directly and swapping the fixture implementation for
 * a real HTTP client touches one file.
 */
export interface ApiClient {
  /** The bearer token this client authenticates with. */
  getIdentityToken(): string;
  /** `GET /v1/inventory/items` (M2-T1) — S4's list. */
  getInventoryItems(): Promise<readonly InventoryItemSummaryDto[]>;
  /**
   * `true` when the most recent {@link getInventoryItems} call could not
   * reach the network and returned a cached result instead (S4's stale-offline
   * banner, copy-deck.md §7 S4). The fixture client is never stale (no
   * network, ever).
   */
  isInventoryStale(): boolean;
  /** S5's payload for one item: summary plus ledger history. `null` if the item does not exist. */
  getInventoryItem(itemId: string): Promise<InventoryItemDetailDto | null>;
  /** What `apps/mobile/app/index.tsx`'s route guard reads (see `src/onboarding/route.ts`). */
  getOnboardingState(): Promise<OnboardingStateDto>;
  /** S1 "Continue with email": signs in as the fixture identity (D-022). */
  signInWithEmail(): Promise<void>;
  /** S1 "Create household": name must already be validated (`src/onboarding/validation.ts`). */
  createHousehold(name: string): Promise<HouseholdDto>;
  /** S1 "Join household": only {@link FIXTURE_JOIN_CODE} succeeds. */
  joinHousehold(code: string): Promise<JoinHouseholdResult>;
  /**
   * S2 Continue: persists one member's final restriction list. `noneConfirmed`
   * is the explicit declaration itself (architect ruling, M3-T2 review F9):
   * the port never infers "no known allergies" from an empty `restrictions`
   * array, because an empty array and "the user hasn't finished yet" would
   * otherwise be indistinguishable at this boundary. Exactly one of
   * `restrictions.length > 0` or `options.noneConfirmed` must hold; the
   * fixture rejects any other combination (see
   * {@link FixtureApiClient.saveMemberRestrictions}).
   */
  saveMemberRestrictions(
    memberId: string,
    restrictions: readonly MemberRestrictionDto[],
    options: { readonly noneConfirmed: boolean },
  ): Promise<void>;
  savePreferences(memberId: string, preferences: readonly string[]): Promise<void>;
  /**
   * S5 "Save correction": appends one `ADJUSTMENT` reaching `newAmountMicros`
   * (an exact decimal-text micros value, never a `number`; the screen's
   * stepper keeps its draft quantity in `bigint` micros throughout, see
   * `app/inventory/[itemId].tsx`). Resolves with (one of) the appended
   * row's id (review F3: the caller needs an *actual* new row to undo,
   * never an assumption like "the last row in history", which could be a
   * different, unrelated write that landed in between; `undo` resolves any
   * row of a write's group back to the whole group, so one id is enough
   * even when the write splits across lots). Rejects with
   * {@link ZeroDeltaError} (fixture) or a coded {@link LedgerRefusedError}
   * (`HttpApiClient`) when `newAmountMicros` equals the current amount.
   */
  correctQuantity(
    itemId: string,
    newAmountMicros: string,
  ): Promise<{ readonly transactionId: string }>;
  /**
   * S5 "Use or remove": removes the full on-hand amount under the reason
   * chip's mapped `TransactionType` (copy-deck.md §5). `reasonLabel` is the
   * secondary reason chip's text ("Spoiled", "Wrong item", …), recorded as
   * the row's own `reason` field (M3-T4a; matches
   * `InventoryWriteRequestDto.reason` exactly, replacing the M3-T3
   * `provenance.source` workaround this doc comment used to describe).
   * Resolves with the appended row's id, same rule as {@link correctQuantity}.
   */
  removeQuantity(
    itemId: string,
    action: RemovalAction,
    reasonLabel?: string,
  ): Promise<{ readonly transactionId: string }>;
  /**
   * S5's undo toast: appends the exact compensating `ADJUSTMENT`(s) for
   * `transactionId`'s whole write. Never deletes it. `itemId` is required
   * (M3-T4a: the real endpoint is scoped to one item,
   * `POST .../items/{itemId}/transactions/{transactionId}/undo`; the
   * fixture no longer searches every item's history to find it).
   */
  undo(itemId: string, transactionId: string): Promise<void>;
  /** S4's "Confirm" action on an AI-tier row: promotes it to Known Fact. Fixture only. */
  confirmAiProposal(itemId: string): Promise<void>;
  /**
   * S7/S8: resolves a scanned or typed code to a product plus its household
   * allergen screening (M3-T4b). The fixture maps a handful of codes to
   * hand-authored literals (`src/scan/fixture-products.ts`); `HttpApiClient`
   * rejects until M2-T3 supplies the real endpoint, and S7/S8 show the
   * copy-deck.md §8 generic fallback for that rejection, same as any other
   * write failure.
   */
  lookupProduct(code: string): Promise<ProductLookupResultDto>;
  /**
   * S8/S9: creates a new inventory item, appending its first `PURCHASE`
   * (barcode) or `INITIAL_STOCK` (manual) row through the fixture ledger so
   * the item appears in S4 and its history in S5 (M3-T4b). `HttpApiClient`
   * rejects until M2-T3 supplies the real endpoint.
   */
  createItem(input: CreateItemRequestDto): Promise<InventoryItemSummaryDto>;
}

/**
 * Fixture implementation: no network call, ever, no persistence across app
 * restarts (in-memory for the session only, per BACKLOG.md M3-T2 Objective
 * (d)). Starts as a brand-new user (`household: null`) unless constructed via
 * {@link FixtureApiClient.returningUser}, which seeds a household whose S2
 * gate is already satisfied and an inventory already stocked (M3-T3) — the
 * fixture's way of representing "returning user" without a real persistence
 * layer (out of scope this ticket).
 */
export class FixtureApiClient implements ApiClient {
  private household: HouseholdDto | null;
  private inventory: Map<string, MutableItemFixture>;

  private constructor(
    initialHousehold: HouseholdDto | null,
    inventory: Map<string, MutableItemFixture>,
  ) {
    this.household = initialHousehold;
    this.inventory = inventory;
  }

  static newUser(): FixtureApiClient {
    return new FixtureApiClient(null, new Map());
  }

  /**
   * A household whose S2 gate is already satisfied for every member, with
   * the Chen fixture inventory stocked. Members/restrictions come from
   * `src/household/fixture-restrictions.ts` (review F8 ruling): the same
   * one source of truth `packages/adapters/scripts/gen-screening-fixtures.mjs`
   * reads to build the household the real allergen engine screens S8's
   * fixture products against, so the two can never silently disagree again.
   */
  static returningUser(): FixtureApiClient {
    const household = buildFixtureHousehold("The Chens");
    return new FixtureApiClient(
      { ...household, members: fixtureChenMembers() },
      buildChenInventory(),
    );
  }

  getIdentityToken(): string {
    return FIXTURE_IDENTITY_TOKEN;
  }

  getInventoryItems(): Promise<readonly InventoryItemSummaryDto[]> {
    return Promise.resolve([...this.inventory.values()].map(toSummaryDto));
  }

  isInventoryStale(): boolean {
    return false;
  }

  getInventoryItem(itemId: string): Promise<InventoryItemDetailDto | null> {
    const item = this.inventory.get(itemId);
    return Promise.resolve(item ? toDetailDto(item) : null);
  }

  getOnboardingState(): Promise<OnboardingStateDto> {
    return Promise.resolve({ household: this.household });
  }

  signInWithEmail(): Promise<void> {
    return Promise.resolve();
  }

  createHousehold(name: string): Promise<HouseholdDto> {
    this.household = buildFixtureHousehold(name);
    this.inventory = new Map();
    return Promise.resolve(this.household);
  }

  joinHousehold(code: string): Promise<JoinHouseholdResult> {
    if (code.trim() !== FIXTURE_JOIN_CODE) {
      return Promise.resolve({ ok: false, message: JOIN_CODE_ERROR_MESSAGE });
    }
    this.household = buildFixtureHousehold("The Chens");
    this.inventory = buildChenInventory();
    return Promise.resolve({ ok: true, household: this.household });
  }

  // try/catch so a synchronous updateMember/validation throw (unknown
  // memberId, no household yet, or a restrictions/noneConfirmed combination
  // that isn't mutually exclusive) becomes a rejected promise, matching
  // every other ApiClient method's async signature, rather than throwing
  // synchronously out of a nominally Promise-returning call.
  saveMemberRestrictions(
    memberId: string,
    restrictions: readonly MemberRestrictionDto[],
    options: { readonly noneConfirmed: boolean },
  ): Promise<void> {
    try {
      if (restrictions.length === 0 && !options.noneConfirmed) {
        throw new Error(
          `FixtureApiClient: saveMemberRestrictions for ${memberId} needs either a restriction or noneConfirmed; got neither`,
        );
      }
      if (restrictions.length > 0 && options.noneConfirmed) {
        throw new Error(
          `FixtureApiClient: saveMemberRestrictions for ${memberId} got both restrictions and noneConfirmed; they are mutually exclusive`,
        );
      }
      this.updateMember(memberId, (m) => ({
        ...m,
        restrictions,
        noneConfirmed: options.noneConfirmed,
      }));
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(toError(error));
    }
  }

  savePreferences(memberId: string, preferences: readonly string[]): Promise<void> {
    try {
      this.updateMember(memberId, (m) => ({ ...m, preferences: [...preferences] }));
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(toError(error));
    }
  }

  correctQuantity(
    itemId: string,
    newAmountMicros: string,
  ): Promise<{ readonly transactionId: string }> {
    try {
      const item = this.requireItem(itemId);
      const row = appendCorrection(
        item,
        parseMicros(newAmountMicros),
        new Date().toISOString(),
        DEAN_ACTOR,
      );
      return Promise.resolve({ transactionId: row.transactionId });
    } catch (error) {
      return Promise.reject(toError(error));
    }
  }

  removeQuantity(
    itemId: string,
    action: RemovalAction,
    reasonLabel?: string,
  ): Promise<{ readonly transactionId: string }> {
    try {
      const item = this.requireItem(itemId);
      const row = appendRemoval(item, action, new Date().toISOString(), DEAN_ACTOR, reasonLabel);
      return Promise.resolve({ transactionId: row.transactionId });
    } catch (error) {
      return Promise.reject(toError(error));
    }
  }

  undo(itemId: string, transactionId: string): Promise<void> {
    try {
      const item = this.requireItem(itemId);
      if (!item.history.some((tx) => tx.transactionId === transactionId)) {
        throw new Error(
          `FixtureApiClient: undo found no transaction ${transactionId} on item ${itemId}`,
        );
      }
      appendUndo(item, transactionId, new Date().toISOString(), DEAN_ACTOR);
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(toError(error));
    }
  }

  confirmAiProposal(itemId: string): Promise<void> {
    try {
      const item = this.requireItem(itemId);
      item.confirmed = true;
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(toError(error));
    }
  }

  lookupProduct(code: string): Promise<ProductLookupResultDto> {
    return Promise.resolve(fixtureLookupProduct(code));
  }

  createItem(input: CreateItemRequestDto): Promise<InventoryItemSummaryDto> {
    try {
      const itemId = nextFixtureItemId(input.source === "BARCODE" ? "scan" : "manual");
      const recordedAt = new Date().toISOString();
      const item = createFixtureItem({
        itemId,
        displayName: input.displayName,
        storageLocation: input.storageLocation,
        unit: input.unit,
        amountMicros: decimalAmountToMicros(input.amount),
        type: input.source === "BARCODE" ? "PURCHASE" : "INITIAL_STOCK",
        recordedAt,
        actor: DEAN_ACTOR,
        quantityProvenance: input.quantityProvenance,
        lotId: `${itemId}-lot-1`,
        expiresAt: input.bestByDate ?? null,
        expiresAtProvenance: input.bestByProvenance ?? null,
        productRef: input.productRef ?? null,
      });
      this.inventory.set(itemId, item);
      return Promise.resolve(toSummaryDto(item));
    } catch (error) {
      return Promise.reject(toError(error));
    }
  }

  private requireItem(itemId: string): MutableItemFixture {
    const item = this.inventory.get(itemId);
    if (!item) {
      throw new Error(`FixtureApiClient: unknown itemId ${itemId}`);
    }
    return item;
  }

  private updateMember(memberId: string, update: (member: MemberDto) => MemberDto): void {
    if (!this.household) {
      throw new Error(`FixtureApiClient: cannot update member ${memberId} with no household yet`);
    }
    const found = this.household.members.some((m) => m.memberId === memberId);
    if (!found) {
      throw new Error(`FixtureApiClient: unknown memberId ${memberId}`);
    }
    this.household = {
      ...this.household,
      members: this.household.members.map((m) => (m.memberId === memberId ? update(m) : m)),
    };
  }
}

/**
 * A network attempt is retried at most this many times (so, at most this
 * many *extra* attempts beyond the first) when `fetch` itself rejects — a
 * genuinely flaky connection, never a well-formed refusal (see this
 * module's doc comment on idempotency keys and retries). One retry is a
 * deliberate, small choice: the ticket does not specify a count or backoff,
 * and a screen still surfaces a failure to the user afterward, who can tap
 * again (reusing nothing from this attempt; a fresh key for a fresh tap).
 */
const MAX_NETWORK_RETRIES = 1;

/**
 * Real HTTP client for the M2-T1/M2-T2 inventory endpoints, used when
 * `EXPO_PUBLIC_API_URL` is set. Onboarding/household state and
 * `confirmAiProposal` delegate to an internal fixture client — see this
 * module's doc comment for why.
 */
export class HttpApiClient implements ApiClient {
  private readonly baseUrl: string;
  private readonly delegate: FixtureApiClient;
  private cachedItems: readonly InventoryItemSummaryDto[] | null = null;
  private stale = false;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
    this.delegate = FixtureApiClient.returningUser();
  }

  getIdentityToken(): string {
    return FIXTURE_IDENTITY_TOKEN;
  }

  private authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${FIXTURE_IDENTITY_TOKEN}` };
  }

  /**
   * POSTs one write/undo body, retrying at most {@link MAX_NETWORK_RETRIES}
   * times on a genuine network failure with the *same* body (so the same
   * idempotency key) — see the module doc comment. A well-formed non-2xx
   * response is never retried: it is parsed for its code and thrown as a
   * {@link LedgerRefusedError} immediately.
   */
  private async postWrite(url: string, body: unknown): Promise<InventoryWriteResponseDto> {
    let attempt = 0;
    for (;;) {
      let response: Response;
      try {
        response = await fetch(url, {
          method: "POST",
          headers: { ...this.authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } catch (networkError) {
        if (attempt >= MAX_NETWORK_RETRIES) {
          throw toError(networkError);
        }
        attempt += 1;
        continue;
      }
      if (!response.ok) {
        const errorBody: unknown = await response.json().catch(() => null);
        throw new LedgerRefusedError(extractErrorCode(errorBody) ?? "INTERNAL");
      }
      const parsedBody: unknown = await response.json();
      if (!isInventoryWriteResponse(parsedBody)) {
        throw new Error(`POST ${url} returned an unexpected response body`);
      }
      return parsedBody;
    }
  }

  async getInventoryItems(): Promise<readonly InventoryItemSummaryDto[]> {
    try {
      const response = await fetch(`${this.baseUrl}${INVENTORY_ITEMS_PATH}`, {
        headers: this.authHeaders(),
      });
      if (!response.ok) {
        throw new Error(`GET ${INVENTORY_ITEMS_PATH} failed with status ${response.status}`);
      }
      // Review F15: `response.json()` is `unknown` at runtime no matter what
      // the type assertion below claims; a malformed or unexpectedly-shaped
      // body (an error page, an envelope change, a proxy's HTML) must not be
      // silently treated as a valid, empty-enough InventoryItemsResponseDto.
      const body: unknown = await response.json();
      if (!isInventoryItemsResponse(body)) {
        throw new Error(`GET ${INVENTORY_ITEMS_PATH} returned an unexpected response body`);
      }
      this.cachedItems = body.items;
      this.stale = false;
      return body.items;
    } catch (error) {
      if (this.cachedItems) {
        // copy-deck.md §7 S4 stale-cache offline: serve the last good read
        // rather than fail the screen. No cache yet (first load failed) is a
        // genuine error the caller must handle.
        this.stale = true;
        return this.cachedItems;
      }
      throw toError(error);
    }
  }

  isInventoryStale(): boolean {
    return this.stale;
  }

  async getInventoryItem(itemId: string): Promise<InventoryItemDetailDto | null> {
    const response = await fetch(`${this.baseUrl}${inventoryItemPath(itemId)}`, {
      headers: this.authHeaders(),
    });
    if (response.status === 404) {
      // Byte-identical to the 404 for an item that does not exist
      // (data-model.md §5): S5's deep-link "This item is no longer
      // available." state does not need to (and cannot) tell the two apart.
      return null;
    }
    if (!response.ok) {
      throw new Error(`GET ${inventoryItemPath(itemId)} failed with status ${response.status}`);
    }
    const body: unknown = await response.json();
    if (!isInventoryItemDetailResponse(body)) {
      throw new Error(`GET ${inventoryItemPath(itemId)} returned an unexpected response body`);
    }
    return body;
  }

  getOnboardingState(): Promise<OnboardingStateDto> {
    return this.delegate.getOnboardingState();
  }

  signInWithEmail(): Promise<void> {
    return this.delegate.signInWithEmail();
  }

  createHousehold(name: string): Promise<HouseholdDto> {
    return this.delegate.createHousehold(name);
  }

  joinHousehold(code: string): Promise<JoinHouseholdResult> {
    return this.delegate.joinHousehold(code);
  }

  saveMemberRestrictions(
    memberId: string,
    restrictions: readonly MemberRestrictionDto[],
    options: { readonly noneConfirmed: boolean },
  ): Promise<void> {
    return this.delegate.saveMemberRestrictions(memberId, restrictions, options);
  }

  savePreferences(memberId: string, preferences: readonly string[]): Promise<void> {
    return this.delegate.savePreferences(memberId, preferences);
  }

  async correctQuantity(
    itemId: string,
    newAmountMicros: string,
  ): Promise<{ readonly transactionId: string }> {
    const body: InventoryWriteRequestDto = {
      idempotencyKey: nextIdempotencyKey(),
      type: "ADJUSTMENT",
      occurredAt: new Date().toISOString(),
      // Decimal text, in the item's unit — the same exact form as
      // QuantityDto.amount, not the raw micros this method receives
      // (contracts' InventoryWriteRequestDto.targetAmount doc comment).
      targetAmount: microsToAmountText(parseMicros(newAmountMicros)),
    };
    const result = await this.postWrite(
      `${this.baseUrl}${inventoryItemTransactionsPath(itemId)}`,
      body,
    );
    // Any row of this write's group resolves `undo` back to the whole
    // group (ApiClient.correctQuantity's doc comment), so the first row is
    // as good as any — there is always at least one (a no-op replay still
    // echoes the original rows, per INVENTORY_WRITE_RESPONSE_DTO's doc
    // comment).
    return { transactionId: result.transactions[0]!.transactionId };
  }

  async removeQuantity(
    itemId: string,
    action: RemovalAction,
    reasonLabel?: string,
  ): Promise<{ readonly transactionId: string }> {
    const body: InventoryWriteRequestDto = {
      idempotencyKey: nextIdempotencyKey(),
      type: action,
      occurredAt: new Date().toISOString(),
      // amount omitted: "the whole on-hand quantity" (contracts doc
      // comment) — S5's "Use or remove" always removes everything.
      ...(reasonLabel === undefined ? {} : { reason: reasonLabel }),
    };
    const result = await this.postWrite(
      `${this.baseUrl}${inventoryItemTransactionsPath(itemId)}`,
      body,
    );
    return { transactionId: result.transactions[0]!.transactionId };
  }

  async undo(itemId: string, transactionId: string): Promise<void> {
    const body: UndoRequestDto = {
      idempotencyKey: nextIdempotencyKey(),
      occurredAt: new Date().toISOString(),
    };
    await this.postWrite(
      `${this.baseUrl}${inventoryTransactionUndoPath(itemId, transactionId)}`,
      body,
    );
  }

  confirmAiProposal(itemId: string): Promise<void> {
    return this.delegate.confirmAiProposal(itemId);
  }

  /**
   * No endpoint exists yet (M2-T3). A clear, typed rejection rather than a
   * silent fixture fallback, per BACKLOG.md M3-T4b Objective (e): S7/S8
   * catch this the same way every other write failure is caught
   * (`messageForLedgerError`), rendering copy-deck.md §8's generic fallback.
   */
  lookupProduct(code: string): Promise<ProductLookupResultDto> {
    return Promise.reject(
      new Error(`lookupProduct(${code}) is not available yet: the real endpoint lands in M2-T3.`),
    );
  }

  /** Same "not available yet" rejection as {@link lookupProduct}, see its doc comment. */
  createItem(input: CreateItemRequestDto): Promise<InventoryItemSummaryDto> {
    void input;
    return Promise.reject(
      new Error("createItem is not available yet: the real endpoint lands in M2-T3."),
    );
  }
}

/** Builds the client this app should use: `HttpApiClient` when a base URL is configured, the fixture client otherwise. */
export function createApiClient(baseUrl: string | null): ApiClient {
  return baseUrl ? new HttpApiClient(baseUrl) : FixtureApiClient.newUser();
}

/**
 * The module-level singleton every screen shares (M3-T2), so create/join in
 * S1 and the restrictions S2 saves are the same in-memory state the root
 * route reads back. `EXPO_PUBLIC_API_URL` is read exactly once, here, at
 * module load (`src/config/env.ts`; Expo inlines it at build time, so a
 * later change requires a rebuild, not a runtime reload).
 */
export const apiClient: ApiClient = createApiClient(getApiBaseUrl());
