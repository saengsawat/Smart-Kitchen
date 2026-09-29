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
 * ## Read vs write, fixture vs HTTP (M3-T3, extended M3-T4a, M3-T4d)
 *
 * `HttpApiClient` implements every inventory read and write M2-T1/M2-T2
 * supply, plus the M2-T3 household and item-creation endpoints (M3-T4d),
 * over real `fetch`, used when `EXPO_PUBLIC_API_URL` is set
 * (`src/config/env.ts`, the one file allowed to read it) and never
 * otherwise (BACKLOG.md M3-T3 Objective (d)): the list
 * (`getInventoryItems`, `GET /v1/inventory/items`), the detail-with-history
 * read (`getInventoryItem`, `GET /v1/inventory/items/{id}`), corrections and
 * removals (`correctQuantity`/`removeQuantity`,
 * `POST /v1/inventory/items/{id}/transactions`), undo
 * (`POST .../{transactionId}/undo`), household create/join/read
 * (`createHousehold`, `joinHousehold`, the household half of
 * `getOnboardingState`) and item creation (`createItem`,
 * `POST /v1/inventory/items`).
 *
 * The server stores no member restrictions until M2-T4 (A3 household
 * permissions), so the *restrictions half* of onboarding state — every
 * member's `restrictions`/`noneConfirmed`/`preferences` — stays entirely
 * client-local even against a real API: never sent, never read from the
 * wire. `HttpApiClient` keeps an internal `FixtureApiClient`
 * (`this.delegate`, started from {@link FixtureApiClient.returningUser} for
 * its inventory fixture only and immediately stripped of its household via
 * {@link FixtureApiClient.clearHouseholdUntilServerSaysOtherwise} — this
 * client must never assume a household it did not get from the server)
 * purely as that local store: `saveMemberRestrictions`/`savePreferences`
 * delegate to it unchanged, and
 * every household read from the server (`createHousehold`, `joinHousehold`,
 * `getOnboardingState`) is folded into it through
 * {@link FixtureApiClient.syncHouseholdFromServer}, which overwrites the
 * household's identity/members/roles from the wire but preserves whatever
 * restrictions/preferences this session already saved for a member who is
 * still present. `confirmAiProposal` still has no endpoint (M2-T3 doesn't
 * add one), so it keeps delegating to the same fixture instance too — its
 * `this.inventory` is unrelated to real HTTP inventory items, a pre-existing
 * gap this ticket does not close (see the worker report).
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
  CreateHouseholdRequestDto,
  CreateHouseholdResponseDto,
  CreateItemRequestDto,
  HouseholdDto,
  HouseholdRoleDto,
  HouseholdSummaryDto,
  InventoryItemDetailDto,
  InventoryItemsResponseDto,
  InventoryItemSummaryDto,
  InventoryWriteRequestDto,
  InventoryWriteResponseDto,
  JoinHouseholdRequestDto,
  JoinHouseholdResponseDto,
  MemberDto,
  MemberRestrictionDto,
  OnboardingStateDto,
  ProductLookupResultDto,
  ShoppingListDto,
  ShoppingRowDto,
  TransactionActorDto,
  UndoRequestDto,
} from "@smart-kitchen/contracts";
import {
  HOUSEHOLD_JOIN_PATH,
  HOUSEHOLD_ME_PATH,
  HOUSEHOLDS_PATH,
  INVENTORY_ITEMS_PATH,
  inventoryItemPath,
  inventoryItemTransactionsPath,
  inventoryTransactionUndoPath,
} from "@smart-kitchen/contracts";
import { getApiBaseUrl, getIdentityToken as resolveIdentityToken } from "../config/env";
import { fixtureChenMembers } from "../household/fixture-restrictions";
import { buildChenInventory } from "../inventory/fixture-household";
import type { RemovalAction } from "../inventory/transactions";
import {
  appendCorrection,
  appendIncrease,
  appendRemoval,
  appendUndo,
  createFixtureItem,
  nextFixtureItemId,
  toDetailDto,
  toSummaryDto,
  type MutableItemFixture,
} from "../inventory/ledger";
import { GENERIC_LEDGER_ERROR_MESSAGE, LedgerRefusedError } from "../inventory/errors";
import { microsToAmountText, parseMicros } from "../inventory/quantity";
import { fixtureLookupProduct } from "../scan/fixture-products";
import { decimalAmountToMicros } from "../scan/quantity";
import {
  buildFixtureShoppingRows,
  fixtureShoppingMembers,
  fixtureShoppingSyncedAt,
  toShoppingListDto,
} from "../shopping/fixture-shopping-list";
import { nextIdempotencyKey } from "./idempotency";

/** The Dean-Chen fixture token (tests/fixtures/identity/README.md). Obviously fake, not a secret. */
export const FIXTURE_IDENTITY_TOKEN = "fixture.dean.chen";

/** The one join code the fixture accepts (tests/fixtures/identity/README.md, BACKLOG.md M3-T2). */
export const FIXTURE_JOIN_CODE = "CHEN-482";

/** Exact copy for a join code that does not match (BACKLOG.md M3-T2 Objective (a)). */
export const JOIN_CODE_ERROR_MESSAGE =
  "That code didn't match a household. Check it with whoever invited you.";

/**
 * copy-deck.md §8 "Household refusals" (added at M2-T3 acceptance), verbatim:
 * `HttpApiClient.joinHousehold`'s 429 `RATE_LIMITED` string (BACKLOG.md
 * M3-T4d Objective (b)). The fixture never rate-limits (no network, no
 * attempt counter), so only `HttpApiClient` ever returns this.
 */
export const RATE_LIMITED_MESSAGE = "Too many tries. Wait a few minutes and try again.";

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
 * Review round 1, F6: `addCheckedOffToInventory` must refuse rather than
 * silently convert when a shopping row's own `unit` disagrees with the
 * inventory item it names (M1-T1: one unit per item, never a silent
 * conversion). Exported as its own pure function so this guard is directly
 * testable without needing to construct an artificial mismatched row
 * through `FixtureApiClient`'s public API (the shipped fixture has none, by
 * design — the units-consistency and gap-drift tests already enforce that).
 */
export function assertShoppingRowUnitMatchesItem(
  rowId: string,
  itemId: string,
  rowUnit: string,
  itemUnit: string,
): void {
  if (rowUnit !== itemUnit) {
    throw new Error(
      `FixtureApiClient: addCheckedOffToInventory(${rowId}) refused: row unit "${rowUnit}" does not match item "${itemId}"'s unit "${itemUnit}"`,
    );
  }
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

/** Same shallow-shape-guard rule (M3-T4d), for `POST /v1/inventory/items`'s body: the bare `InventoryItemSummaryDto`, not an envelope. */
function isInventoryItemSummary(body: unknown): body is InventoryItemSummaryDto {
  if (typeof body !== "object" || body === null) {
    return false;
  }
  const candidate = body as { itemId?: unknown; quantity?: unknown; provenance?: unknown };
  return (
    typeof candidate.itemId === "string" &&
    typeof candidate.quantity === "object" &&
    candidate.quantity !== null &&
    typeof candidate.provenance === "object" &&
    candidate.provenance !== null
  );
}

/** Same shallow-shape-guard rule (M3-T4d), for `GET /v1/households/me`'s and every household envelope's `HouseholdSummaryDto` member. */
function isHouseholdSummary(body: unknown): body is HouseholdSummaryDto {
  if (typeof body !== "object" || body === null) {
    return false;
  }
  const candidate = body as { householdId?: unknown; name?: unknown; members?: unknown };
  return (
    typeof candidate.householdId === "string" &&
    typeof candidate.name === "string" &&
    Array.isArray(candidate.members)
  );
}

/** Same shallow-shape-guard rule (M3-T4d), for `POST /v1/households`'s `{ household, joinCode }` body. */
function isCreateHouseholdResponse(body: unknown): body is CreateHouseholdResponseDto {
  if (typeof body !== "object" || body === null) {
    return false;
  }
  const candidate = body as { household?: unknown; joinCode?: unknown };
  if (!isHouseholdSummary(candidate.household)) {
    return false;
  }
  const joinCode = candidate.joinCode as { code?: unknown; issuedAt?: unknown } | undefined;
  return (
    typeof joinCode === "object" &&
    joinCode !== null &&
    typeof joinCode.code === "string" &&
    typeof joinCode.issuedAt === "string"
  );
}

/** Same shallow-shape-guard rule (M3-T4d), for `POST /v1/households/join`'s `{ household, alreadyMember }` body. */
function isJoinHouseholdResponse(body: unknown): body is JoinHouseholdResponseDto {
  if (typeof body !== "object" || body === null) {
    return false;
  }
  const candidate = body as { household?: unknown; alreadyMember?: unknown };
  return isHouseholdSummary(candidate.household) && typeof candidate.alreadyMember === "boolean";
}

/**
 * Maps the wire's `HouseholdSummaryDto` (M2-T3: `memberId`,
 * `displayInitials`, `role`, `isCaller`, never a full name or any
 * restriction) into {@link FixtureApiClient.syncHouseholdFromServer}'s
 * input shape (M3-T4d). `displayName` is the member's initials: M2-T3 never
 * sends a full name over the wire (household.ts's header, rule 2), so
 * initials are the only textual identity this client has for a member it
 * did not create locally. Exported so this mapping is directly testable
 * without a fake `fetch` (BACKLOG.md M3-T4d "Tests required").
 */
export function householdSyncInputFromSummary(summary: HouseholdSummaryDto): {
  readonly householdId: string;
  readonly name: string;
  readonly members: readonly {
    readonly memberId: string;
    readonly displayName: string;
    readonly role: HouseholdRoleDto;
  }[];
} {
  return {
    householdId: summary.householdId,
    name: summary.name,
    members: summary.members.map((member) => ({
      memberId: member.memberId,
      displayName: member.displayInitials,
      role: member.role,
    })),
  };
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
  | {
      readonly ok: true;
      readonly household: HouseholdDto;
      /**
       * `true` when the caller already belonged and nothing was added
       * (`JoinHouseholdResponseDto.alreadyMember`, M2-T3's idempotent-join
       * rule). Optional, `HttpApiClient` only: `FixtureApiClient` has no
       * server-side membership to check twice against, so it never sets
       * this field (undefined, not false — there is no real answer to give).
       */
      readonly alreadyMember?: boolean;
    }
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
  /**
   * S1 "Create household": name must already be validated
   * (`src/onboarding/validation.ts`). `joinCode` is `HttpApiClient`-only
   * (M3-T4d review F1): it carries the wire's one-time `JoinCodeDto.code`
   * from `POST /v1/households`, present exactly once, on this call's own
   * result, never re-fetchable later — the server itself only sends the
   * plaintext once (household.ts's header, rule 3), so `app/onboarding/
   * account.tsx` must capture it here or not at all, and shows a one-time
   * interstitial on that path only. `FixtureApiClient` never sets this
   * field (`undefined`, not a stand-in code): the fixture path never showed
   * a created household's code before this ticket, and the review corrected
   * the ticket's original premise that it did (the prototype puts a
   * household's code on S12/profile, not S1) — so the fixture path goes
   * straight to S2 after create, exactly as it always has.
   */
  createHousehold(name: string): Promise<HouseholdDto & { readonly joinCode?: string }>;
  /** S1 "Join household": only {@link FIXTURE_JOIN_CODE} succeeds against the fixture. */
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
  /**
   * `true` when this client believes it is currently offline (M3-T5, ADR-010
   * option C). `FixtureApiClient` via its dev-only
   * {@link FixtureApiClient.setOfflineForDev} toggle (there is no real
   * network to lose, so a manual switch is the only way to exercise S11's
   * offline states against it — see {@link hasDevOfflineToggle});
   * `HttpApiClient` via the same signal {@link isInventoryStale} already
   * tracks (a fetch that failed after a prior success, flipped back on the
   * next success).
   */
  isOffline(): boolean;
  /**
   * Subscribes to every {@link isOffline} change; returns an unsubscribe
   * function. Never fires for the state at subscription time, only a later
   * change (S11 reads {@link isOffline} directly for the initial render).
   */
  subscribeOffline(listener: (offline: boolean) => void): () => void;
  /** S11's list (M3-T5). Fixture only until M7; `HttpApiClient` rejects with the established "not available yet" pattern. */
  getShoppingList(): Promise<ShoppingListDto>;
  /**
   * S11's check control, toggling one row `open`/`done`. `idempotencyKey` is
   * minted by the *caller* at tap time (unlike every other write in this
   * port, which mints its own): the screen must decide, before this call,
   * whether to invoke it directly (online) or hold the same key for a later
   * replay (offline, `src/shopping/queue.ts`), so the key has to exist
   * before that decision is made.
   */
  checkOffShoppingRow(rowId: string, checked: boolean, idempotencyKey: string): Promise<void>;
  /** S11's AI-row Remove (decline): deletes the suggestion row. Fixture only until M7. */
  removeShoppingSuggestion(rowId: string): Promise<void>;
  /**
   * S11's close-the-loop Add: appends one `PURCHASE` of the row's
   * `buyMicros` to `row.itemId`'s ledger (never a quantity mutation,
   * CLAUDE.md rule 10). Refused while offline by the screen itself
   * (BACKLOG.md M3-T5 Objective (f): "the ledger write needs the server"),
   * so, unlike {@link checkOffShoppingRow}, this is never queued.
   */
  addCheckedOffToInventory(
    rowId: string,
    idempotencyKey: string,
  ): Promise<{ readonly transactionId: string }>;
}

/**
 * The shape of {@link FixtureApiClient}'s dev-only offline toggle, not part
 * of {@link ApiClient} itself (`HttpApiClient`'s offline state is derived
 * from real fetch outcomes, never a manual switch — see `isOffline`'s doc
 * comment). A screen feature-detects it with {@link hasDevOfflineToggle}
 * rather than assuming which concrete client it holds.
 */
export interface DevOfflineToggle {
  setOfflineForDev(offline: boolean): void;
}

/** Narrows `client` to {@link DevOfflineToggle} when it actually has the dev toggle (today, only {@link FixtureApiClient}). */
export function hasDevOfflineToggle(client: ApiClient): client is ApiClient & DevOfflineToggle {
  return typeof (client as Partial<DevOfflineToggle>).setOfflineForDev === "function";
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
  /**
   * M3-T5's shopping list, seeded once per instance (independent of
   * household create/join, unlike `inventory`): the fixture ships one static
   * Chen list regardless of onboarding path, the same simplification the
   * ticket's own "the fixture client ships the prototype's Chen list"
   * wording assumes. Flagged in the worker report: a `newUser()` instance
   * (empty `inventory`) still carries rows naming Chen inventory item ids,
   * so `addCheckedOffToInventory` for those rows only resolves once the
   * household has joined/returned to the Chen inventory, same as this
   * ticket's own acceptance criteria exercise it. Re-seeded (a fresh copy,
   * same as `inventory`) on {@link createHousehold}/{@link joinHousehold} so
   * a later household never sees an earlier one's check-offs.
   */
  private shoppingRows: Map<string, ShoppingRowDto> = buildFixtureShoppingRows();
  /**
   * Keyed by rowId (review round 1, F3): a row's `addCheckedOffToInventory`
   * result, once it has one, is returned again for every later call on that
   * same row rather than appending a second `PURCHASE` (CLAUDE.md rule 10).
   * Reset alongside `shoppingRows`.
   */
  private appliedShoppingWrites = new Map<string, { readonly transactionId: string }>();
  private offline = false;
  private offlineListeners: Array<(offline: boolean) => void> = [];

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

  /**
   * M3-T4d: `HttpApiClient`'s hook to keep this fixture instance's household
   * in step with the real server household it read (`createHousehold`,
   * `joinHousehold`, `getOnboardingState`), while keeping every member's
   * restrictions/preferences entirely client-local (the server stores none
   * until M2-T4). Replaces `householdId`/`name`/`members` identity, role and
   * display name wholesale from `next` (the wire's own truth), but for each
   * incoming member carries forward whatever `restrictions`/`noneConfirmed`/
   * `preferences` this same instance already had for that `memberId` — a
   * member dropped from `next` (should not happen against a real
   * household) is simply dropped, never left as a stale row. Returns the
   * resulting household so a caller doesn't need a second
   * `getOnboardingState()` round trip just to read back what it set.
   */
  syncHouseholdFromServer(next: {
    readonly householdId: string;
    readonly name: string;
    readonly members: readonly {
      readonly memberId: string;
      readonly displayName: string;
      readonly role: HouseholdRoleDto;
    }[];
  }): HouseholdDto {
    const previousByMemberId = new Map(
      (this.household?.members ?? []).map((member) => [member.memberId, member]),
    );
    this.household = {
      householdId: next.householdId,
      name: next.name,
      members: next.members.map((member) => {
        const previous = previousByMemberId.get(member.memberId);
        return {
          memberId: member.memberId,
          displayName: member.displayName,
          role: member.role,
          restrictions: previous?.restrictions ?? [],
          noneConfirmed: previous?.noneConfirmed ?? false,
          preferences: previous?.preferences ?? [],
        };
      }),
    };
    return this.household;
  }

  /**
   * M3-T4d: strips just the household half of a {@link returningUser}
   * instance, leaving its inventory/shopping fixtures alone. `HttpApiClient`
   * uses this once, at construction: it still starts its internal delegate
   * from {@link returningUser} (not {@link newUser}) purely for
   * `confirmAiProposal`'s pre-existing, still-fixture-only inventory (that
   * method has no real endpoint yet, an out-of-scope gap this ticket does
   * not close), but this client's *household* must never be assumed — it
   * comes only from what the server actually returns (`createHousehold`,
   * `joinHousehold`, `getOnboardingState`). Without this call,
   * `returningUser()`'s hardcoded, already-onboarded Chen fixture household
   * would sit there as a false positive until the first real household
   * round trip overwrote it.
   */
  clearHouseholdUntilServerSaysOtherwise(): void {
    this.household = null;
  }

  signInWithEmail(): Promise<void> {
    return Promise.resolve();
  }

  createHousehold(name: string): Promise<HouseholdDto & { readonly joinCode?: string }> {
    this.household = buildFixtureHousehold(name);
    this.inventory = new Map();
    this.shoppingRows = buildFixtureShoppingRows();
    this.appliedShoppingWrites = new Map();
    // M3-T4d review F1: no `joinCode` here. The ticket's original premise
    // was wrong — the fixture path never showed a code after create
    // (FIXTURE_JOIN_CODE/CHEN-482 is only ever the *join* card's example
    // placeholder; the prototype puts a household's code on S12/profile,
    // not S1). `undefined` (the field simply absent) is what tells
    // `app/onboarding/account.tsx` to skip the post-create interstitial and
    // go straight to S2, exactly like every fixture-path create before this
    // ticket.
    return Promise.resolve({ ...this.household });
  }

  joinHousehold(code: string): Promise<JoinHouseholdResult> {
    if (code.trim() !== FIXTURE_JOIN_CODE) {
      return Promise.resolve({ ok: false, message: JOIN_CODE_ERROR_MESSAGE });
    }
    this.household = buildFixtureHousehold("The Chens");
    this.inventory = buildChenInventory();
    this.shoppingRows = buildFixtureShoppingRows();
    this.appliedShoppingWrites = new Map();
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

  isOffline(): boolean {
    return this.offline;
  }

  subscribeOffline(listener: (offline: boolean) => void): () => void {
    this.offlineListeners.push(listener);
    return () => {
      this.offlineListeners = this.offlineListeners.filter((l) => l !== listener);
    };
  }

  /** See {@link DevOfflineToggle}'s doc comment. */
  setOfflineForDev(offline: boolean): void {
    if (offline === this.offline) {
      return;
    }
    this.offline = offline;
    for (const listener of this.offlineListeners) {
      listener(offline);
    }
  }

  getShoppingList(): Promise<ShoppingListDto> {
    return Promise.resolve(
      toShoppingListDto(this.shoppingRows, fixtureShoppingMembers(), fixtureShoppingSyncedAt()),
    );
  }

  checkOffShoppingRow(rowId: string, checked: boolean, idempotencyKey: string): Promise<void> {
    // Idempotent by construction (setting the same status/checker twice is a
    // no-op on this in-memory map, unlike a ledger append), so the key is
    // accepted for interface parity with the offline queue's replay call but
    // not otherwise consulted.
    void idempotencyKey;
    try {
      const row = this.requireShoppingRow(rowId);
      this.shoppingRows.set(rowId, {
        ...row,
        status: checked ? "done" : "open",
        checkedOffBy: checked ? (DEAN_ACTOR.displayInitials ?? "DC") : null,
      });
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(toError(error));
    }
  }

  removeShoppingSuggestion(rowId: string): Promise<void> {
    if (!this.shoppingRows.delete(rowId)) {
      return Promise.reject(new Error(`FixtureApiClient: unknown shopping rowId ${rowId}`));
    }
    return Promise.resolve();
  }

  /**
   * Review round 1, F3/F6: keyed by **rowId**, not the idempotency key.
   * `buyMicros` is a fixed fact of the row for the life of this session
   * (the same value every other read of the row shows, checked off or
   * not — same reasoning as `formatShoppingAmount` never re-deriving it),
   * so "the same check-off's gap, bought twice" is a real duplicate no
   * matter how many times the row gets unchecked and re-checked in between,
   * or how many different idempotency keys a caller mints across those
   * taps. The idempotency key is still accepted (parity with the real M7
   * endpoint, which will want it for its own network-retry safety) but no
   * longer the dedup key here.
   */
  addCheckedOffToInventory(
    rowId: string,
    idempotencyKey: string,
  ): Promise<{ readonly transactionId: string }> {
    void idempotencyKey;
    try {
      const cached = this.appliedShoppingWrites.get(rowId);
      if (cached) {
        // Already added once for this row (a double-tap before the first
        // call settled, a retry, or a later Add after an uncheck/re-check
        // cycle): return that same result rather than a second PURCHASE
        // row (CLAUDE.md rule 10; the exact "duplicate PURCHASE rows on
        // replay" risk BACKLOG.md M3-T5's review model calls out).
        return Promise.resolve(cached);
      }
      const row = this.requireShoppingRow(rowId);
      // Review F3: a data-integrity guard, not just a client-side one — Add
      // only ever makes sense for a row this session has actually checked
      // off (buyMicros is "how much was bought", not "how much to buy
      // right now"; appending it against an open row would silently
      // fabricate a purchase nobody confirmed).
      if (row.status !== "done") {
        throw new Error(
          `FixtureApiClient: addCheckedOffToInventory(${rowId}) refused: the row is not checked off`,
        );
      }
      if (row.itemId === null) {
        throw new Error(
          `FixtureApiClient: addCheckedOffToInventory(${rowId}) has no itemId; the screen must route this row through S9 instead`,
        );
      }
      const item = this.requireItem(row.itemId);
      assertShoppingRowUnitMatchesItem(rowId, row.itemId, row.unit, item.unit);
      appendIncrease(item, {
        type: "PURCHASE",
        amountMicros: parseMicros(row.buyMicros),
        recordedAt: new Date().toISOString(),
        actor: DEAN_ACTOR,
        provenance: {
          tier: "KNOWN_FACT",
          source: "shopping list check-off",
          confidence: null,
          recordedAt: null,
        },
      });
      const appended = item.history[item.history.length - 1]!;
      const result = { transactionId: appended.transactionId };
      this.appliedShoppingWrites.set(rowId, result);
      return Promise.resolve(result);
    } catch (error) {
      return Promise.reject(toError(error));
    }
  }

  private requireShoppingRow(rowId: string): ShoppingRowDto {
    const row = this.shoppingRows.get(rowId);
    if (!row) {
      throw new Error(`FixtureApiClient: unknown shopping rowId ${rowId}`);
    }
    return row;
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
 * Real HTTP client for the M2-T1/M2-T2 inventory endpoints and the M2-T3
 * household/item-creation endpoints (M3-T4d), used when
 * `EXPO_PUBLIC_API_URL` is set. Onboarding's restrictions half and
 * `confirmAiProposal` delegate to an internal fixture client — see this
 * module's doc comment for why.
 */
export class HttpApiClient implements ApiClient {
  private readonly baseUrl: string;
  private readonly delegate: FixtureApiClient;
  private cachedItems: readonly InventoryItemSummaryDto[] | null = null;
  private stale = false;
  private offlineListeners: Array<(offline: boolean) => void> = [];

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
    // M3-T4d: `.returningUser()`, not `.newUser()` — only for
    // `confirmAiProposal`'s pre-existing, still-fixture-only inventory (a
    // gap outside this ticket's scope) — then immediately stripped of its
    // household: this client's household comes only from the server
    // (invariant: never assume a household it did not get from the
    // server), and `.returningUser()`'s household is the already-onboarded
    // Chen fixture, a false positive this client must not start with.
    this.delegate = FixtureApiClient.returningUser();
    this.delegate.clearHouseholdUntilServerSaysOtherwise();
  }

  /**
   * `EXPO_PUBLIC_IDENTITY_TOKEN` when set (M3-T4d Objective (e)), else the
   * same fixture default `FixtureApiClient` uses. Read fresh on every call,
   * not cached at construction: `src/config/env.ts` itself only ever
   * re-reads `process.env` (Expo inlines it at build time either way), so
   * this just avoids adding a second, redundant place that could go stale.
   */
  getIdentityToken(): string {
    return resolveIdentityToken();
  }

  private authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.getIdentityToken()}` };
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
      this.setStale(false);
      return body.items;
    } catch (error) {
      if (this.cachedItems) {
        // copy-deck.md §7 S4 stale-cache offline: serve the last good read
        // rather than fail the screen. No cache yet (first load failed) is a
        // genuine error the caller must handle.
        this.setStale(true);
        return this.cachedItems;
      }
      throw toError(error);
    }
  }

  isInventoryStale(): boolean {
    return this.stale;
  }

  /** M3-T5's connectivity signal, reusing this same stale flag (see {@link ApiClient.isOffline}'s doc comment). */
  isOffline(): boolean {
    return this.stale;
  }

  subscribeOffline(listener: (offline: boolean) => void): () => void {
    this.offlineListeners.push(listener);
    return () => {
      this.offlineListeners = this.offlineListeners.filter((l) => l !== listener);
    };
  }

  private setStale(value: boolean): void {
    if (value === this.stale) {
      return;
    }
    this.stale = value;
    for (const listener of this.offlineListeners) {
      listener(value);
    }
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

  /**
   * `GET /v1/households/me` (M3-T4d Objective (c)). The route's only 403 is
   * `no-household` (`apps/api/src/http/authorization.ts`: `householdRoute()`
   * carries no role restriction, so a signed-in caller with a household
   * never gets 403 here) — read as "no household yet", not a failure to
   * surface. A successful read is folded into `this.delegate` so the
   * restrictions half of onboarding state stays attached to the right
   * member ids (see the module doc comment).
   */
  async getOnboardingState(): Promise<OnboardingStateDto> {
    const response = await fetch(`${this.baseUrl}${HOUSEHOLD_ME_PATH}`, {
      headers: this.authHeaders(),
    });
    if (response.status === 403) {
      return { household: null };
    }
    if (!response.ok) {
      throw new Error(`GET ${HOUSEHOLD_ME_PATH} failed with status ${String(response.status)}`);
    }
    const body: unknown = await response.json();
    if (!isHouseholdSummary(body)) {
      throw new Error(`GET ${HOUSEHOLD_ME_PATH} returned an unexpected response body`);
    }
    this.delegate.syncHouseholdFromServer(householdSyncInputFromSummary(body));
    return this.delegate.getOnboardingState();
  }

  signInWithEmail(): Promise<void> {
    return this.delegate.signInWithEmail();
  }

  /**
   * `POST /v1/households` (M3-T4d Objective (a)). No idempotency key in
   * {@link CreateHouseholdRequestDto} (M2-T3 never gave this endpoint one),
   * so unlike every write below, a network failure here is not retried:
   * retrying blindly could create a second household if the first request
   * actually landed and only the response was lost. A non-2xx response is
   * thrown as a {@link LedgerRefusedError} so a caller can render it through
   * `messageForLedgerError`, same convention as every other coded refusal.
   */
  async createHousehold(name: string): Promise<HouseholdDto & { readonly joinCode?: string }> {
    const body: CreateHouseholdRequestDto = { name: name.trim() };
    const response = await fetch(`${this.baseUrl}${HOUSEHOLDS_PATH}`, {
      method: "POST",
      headers: { ...this.authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const errorBody: unknown = await response.json().catch(() => null);
      throw new LedgerRefusedError(extractErrorCode(errorBody) ?? "INTERNAL");
    }
    const parsedBody: unknown = await response.json();
    if (!isCreateHouseholdResponse(parsedBody)) {
      throw new Error(`POST ${HOUSEHOLDS_PATH} returned an unexpected response body`);
    }
    const household = this.delegate.syncHouseholdFromServer(
      householdSyncInputFromSummary(parsedBody.household),
    );
    // The plaintext code is in this one response and nowhere else
    // (household.ts's header, rule 3) — attached here, never re-fetchable.
    return { ...household, joinCode: parsedBody.joinCode.code };
  }

  /**
   * `POST /v1/households/join` (M3-T4d Objective (b)). Unlike
   * {@link createHousehold}, every failure here (network, 404
   * `JOIN_CODE_INVALID`, 429 `RATE_LIMITED`, a malformed 2xx body — review
   * F10 — anything else) resolves `{ ok: false }` rather than rejecting:
   * `JoinHouseholdResult` already models "this didn't work, here is what to
   * tell the person", and S1 shows only the deck string, never a server
   * message (invariant) or an unhandled rejection. A join carries no
   * idempotency key either (same as create); a network failure is answered
   * with the generic fallback rather than silently retried.
   */
  async joinHousehold(code: string): Promise<JoinHouseholdResult> {
    let response: Response;
    try {
      const body: JoinHouseholdRequestDto = { code };
      response = await fetch(`${this.baseUrl}${HOUSEHOLD_JOIN_PATH}`, {
        method: "POST",
        headers: { ...this.authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      return { ok: false, message: GENERIC_LEDGER_ERROR_MESSAGE };
    }
    if (!response.ok) {
      const errorBody: unknown = await response.json().catch(() => null);
      const errorCode = extractErrorCode(errorBody);
      if (errorCode === "JOIN_CODE_INVALID") {
        return { ok: false, message: JOIN_CODE_ERROR_MESSAGE };
      }
      if (errorCode === "RATE_LIMITED") {
        return { ok: false, message: RATE_LIMITED_MESSAGE };
      }
      return { ok: false, message: GENERIC_LEDGER_ERROR_MESSAGE };
    }
    // Review F10: a malformed 2xx body (an unparsable body, an envelope
    // change, a proxy's HTML) is a failure this typed result already knows
    // how to carry — resolve it the same as every other unreachable-server
    // case, never an unhandled rejection out of a nominally
    // never-throws-on-a-known-outcome method.
    const parsedBody: unknown = await response.json().catch(() => null);
    if (!isJoinHouseholdResponse(parsedBody)) {
      return { ok: false, message: GENERIC_LEDGER_ERROR_MESSAGE };
    }
    const household = this.delegate.syncHouseholdFromServer(
      householdSyncInputFromSummary(parsedBody.household),
    );
    return { ok: true, household, alreadyMember: parsedBody.alreadyMember };
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

  /**
   * `POST /v1/inventory/items` (M3-T4d Objective (d)). `input.idempotencyKey`
   * is minted once by the caller (S8/S9, at Save-tap time, the M3-T4a
   * pattern) and reused unchanged on this method's own internal
   * network-retry, same rule as {@link postWrite}, so a retried save after a
   * lost response still lands as one item, never two. A 200 (replay) and a
   * 201 (created) both resolve the same way: the server's own
   * `InventoryItemSummaryDto`. A non-2xx is thrown as a
   * {@link LedgerRefusedError}: 409 `IDEMPOTENCY_KEY_CONFLICT` renders its
   * §8 sentence, a 400 validation refusal (an unrecognised `ledgerCode` like
   * `INVALID_FIELD`, or none at all) falls through `ledgerErrorMessage` to
   * the generic fallback, exactly as Objective (d) asks.
   */
  async createItem(input: CreateItemRequestDto): Promise<InventoryItemSummaryDto> {
    let attempt = 0;
    for (;;) {
      let response: Response;
      try {
        response = await fetch(`${this.baseUrl}${INVENTORY_ITEMS_PATH}`, {
          method: "POST",
          headers: { ...this.authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify(input),
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
      if (!isInventoryItemSummary(parsedBody)) {
        throw new Error(`POST ${INVENTORY_ITEMS_PATH} returned an unexpected response body`);
      }
      return parsedBody;
    }
  }

  /**
   * No shopping endpoint exists yet (M7). Same "not available yet"
   * rejection as {@link lookupProduct}; S11 shows copy-deck.md §8's generic
   * fallback with Try again for all four shopping methods below (BACKLOG.md
   * M3-T5 Objective (h)).
   */
  getShoppingList(): Promise<ShoppingListDto> {
    return Promise.reject(
      new Error("getShoppingList is not available yet: the real endpoint lands in M7."),
    );
  }

  /** Same "not available yet" rejection as {@link getShoppingList}. */
  checkOffShoppingRow(rowId: string, checked: boolean, idempotencyKey: string): Promise<void> {
    void rowId;
    void checked;
    void idempotencyKey;
    return Promise.reject(
      new Error("checkOffShoppingRow is not available yet: the real endpoint lands in M7."),
    );
  }

  /** Same "not available yet" rejection as {@link getShoppingList}. */
  removeShoppingSuggestion(rowId: string): Promise<void> {
    void rowId;
    return Promise.reject(
      new Error("removeShoppingSuggestion is not available yet: the real endpoint lands in M7."),
    );
  }

  /** Same "not available yet" rejection as {@link getShoppingList}. */
  addCheckedOffToInventory(
    rowId: string,
    idempotencyKey: string,
  ): Promise<{ readonly transactionId: string }> {
    void rowId;
    void idempotencyKey;
    return Promise.reject(
      new Error("addCheckedOffToInventory is not available yet: the real endpoint lands in M7."),
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
