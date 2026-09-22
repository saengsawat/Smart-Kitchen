/**
 * `ApiClient` port + fixture/HTTP implementations (M3-T1, extended M3-T2, M3-T3).
 *
 * Only `@smart-kitchen/contracts` DTOs cross this boundary (M3-T1 invariant:
 * `apps/mobile` never imports `@smart-kitchen/domain`). `packages/adapters`
 * is no longer a dependency of this app either (M3-T3 cleanup: nothing here
 * has imported it since M3-T2 moved the fixture inventory rows onto
 * contracts-shaped literals; the dependency and its tsconfig project
 * reference are removed in this ticket, discharging the M2-T1 review's
 * `expo export` bundling blocker for good).
 *
 * ## Read vs write, fixture vs HTTP (M3-T3)
 *
 * `HttpApiClient` implements the port's inventory *list* read
 * (`getInventoryItems`, `GET /v1/inventory/items`, M2-T1) over real `fetch`,
 * used when `EXPO_PUBLIC_API_URL` is set (`src/config/env.ts`, the one file
 * allowed to read it) and never otherwise (BACKLOG.md M3-T3 Objective (d)).
 * Everything else on the port, including single-item detail/history,
 * onboarding/household state, and every write method, has no corresponding
 * endpoint yet (M2-T2 supplies the write endpoints; a read-detail-with-
 * history endpoint and M2-T3's household endpoints are later tickets still).
 * `HttpApiClient` therefore delegates those to an internal fixture client
 * (`FixtureApiClient.returningUser()`) rather than leaving them unimplemented
 * dead ends, and `getInventoryItem` degrades honestly: it returns the real
 * list row wrapped with an *empty* history, never a fabricated one, until a
 * real history endpoint exists. This composition, and its scope, is flagged
 * for the reviewer in the worker report.
 */

import type {
  HouseholdDto,
  InventoryItemDetailDto,
  InventoryItemsResponseDto,
  InventoryItemSummaryDto,
  MemberDto,
  MemberRestrictionDto,
  OnboardingStateDto,
  TransactionActorDto,
} from "@smart-kitchen/contracts";
import { INVENTORY_ITEMS_PATH } from "@smart-kitchen/contracts";
import { getApiBaseUrl } from "../config/env";
import { buildChenInventory } from "../inventory/fixture-household";
import type { RemovalAction } from "../inventory/transactions";
import {
  appendCorrection,
  appendRemoval,
  appendUndo,
  toDetailDto,
  toSummaryDto,
  type MutableItemFixture,
} from "../inventory/ledger";
import { parseMicros } from "../inventory/quantity";

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
   * S5 "Save correction": appends one `ADJUSTMENT` carrying the signed delta
   * to reach `newAmountMicros` (an exact decimal-text micros value, never a
   * `number`; the screen's stepper keeps its draft quantity in `bigint`
   * micros throughout, see `app/inventory/[itemId].tsx`). Resolves with the
   * appended row's id (review F3: the caller needs the *actual* new row to
   * undo, never an assumption like "the last row in history", which could be
   * a different, unrelated write that landed in between). Rejects with
   * {@link ZeroDeltaError} when `newAmountMicros` equals the current amount.
   * Fixture only (M2-T2 supplies the real write endpoint).
   */
  correctQuantity(
    itemId: string,
    newAmountMicros: string,
  ): Promise<{ readonly transactionId: string }>;
  /**
   * S5 "Use or remove": removes the full on-hand amount under the reason
   * chip's mapped `TransactionType` (copy-deck.md §5). `reasonLabel` is the
   * secondary reason chip's text ("Spoiled", "Wrong item", …), recorded as
   * the row's `correlationLabel` (see `src/inventory/transactions.ts`'s doc
   * comment on why there is no separate `reason` field on the wire). Fixture
   * only.
   */
  removeQuantity(itemId: string, action: RemovalAction, reasonLabel?: string): Promise<void>;
  /** S5's undo toast: appends the exact compensating `ADJUSTMENT` for `transactionId`. Never deletes it. Fixture only. */
  undo(transactionId: string): Promise<void>;
  /** S4's "Confirm" action on an AI-tier row: promotes it to Known Fact. Fixture only. */
  confirmAiProposal(itemId: string): Promise<void>;
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

  /** A household whose S2 gate is already satisfied for every member, with the Chen fixture inventory stocked. */
  static returningUser(): FixtureApiClient {
    const household = buildFixtureHousehold("The Chens");
    const [owner, member] = household.members as [MemberDto, MemberDto];
    return new FixtureApiClient(
      {
        ...household,
        members: [
          { ...owner, noneConfirmed: true },
          {
            ...member,
            restrictions: [
              { kind: "MAJOR", code: "sesame", label: "sesame", severity: "standard" },
            ],
          },
        ],
      },
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

  removeQuantity(itemId: string, action: RemovalAction, reasonLabel?: string): Promise<void> {
    try {
      const item = this.requireItem(itemId);
      appendRemoval(item, action, new Date().toISOString(), DEAN_ACTOR, reasonLabel);
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(toError(error));
    }
  }

  undo(transactionId: string): Promise<void> {
    try {
      const item = [...this.inventory.values()].find((candidate) =>
        candidate.history.some((tx) => tx.transactionId === transactionId),
      );
      if (!item) {
        throw new Error(`FixtureApiClient: undo found no transaction ${transactionId}`);
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
 * Real HTTP read for `GET /v1/inventory/items` (M2-T1), used when
 * `EXPO_PUBLIC_API_URL` is set. Everything else on the port delegates to an
 * internal fixture client — see this module's doc comment for why.
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

  async getInventoryItems(): Promise<readonly InventoryItemSummaryDto[]> {
    try {
      const response = await fetch(`${this.baseUrl}${INVENTORY_ITEMS_PATH}`, {
        headers: { Authorization: `Bearer ${FIXTURE_IDENTITY_TOKEN}` },
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

  getInventoryItem(itemId: string): Promise<InventoryItemDetailDto | null> {
    // No per-item history-read endpoint exists yet (see module doc comment):
    // this is the real list row, honestly wrapped with an empty history,
    // never a fabricated one.
    const found = this.cachedItems?.find((item) => item.itemId === itemId) ?? null;
    return Promise.resolve(found ? { summary: found, history: [] } : null);
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

  correctQuantity(
    itemId: string,
    newAmountMicros: string,
  ): Promise<{ readonly transactionId: string }> {
    return this.delegate.correctQuantity(itemId, newAmountMicros);
  }

  removeQuantity(itemId: string, action: RemovalAction, reasonLabel?: string): Promise<void> {
    return this.delegate.removeQuantity(itemId, action, reasonLabel);
  }

  undo(transactionId: string): Promise<void> {
    return this.delegate.undo(transactionId);
  }

  confirmAiProposal(itemId: string): Promise<void> {
    return this.delegate.confirmAiProposal(itemId);
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
