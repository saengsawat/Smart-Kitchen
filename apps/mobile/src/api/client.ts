/**
 * `ApiClient` port + fixture implementation (M3-T1, extended M3-T2).
 *
 * Only `@smart-kitchen/contracts` DTOs cross this boundary (M3-T1 invariant:
 * `apps/mobile` never imports `@smart-kitchen/domain`). No network call is
 * made anywhere in this file.
 *
 * ## Why this no longer imports `@smart-kitchen/adapters` (M3-T2 fix)
 *
 * M3-T1 sourced `getInventoryItems()`'s fixture rows from
 * `@smart-kitchen/adapters`' `FIXTURE_INVENTORY_ITEMS_CHEN`, built through the
 * real domain ledger functions. That was harmless while no screen imported
 * this file (M2-T1's review, triaged at acceptance: "importing
 * `FixtureApiClient` from any screen fails `expo export` because the
 * `@smart-kitchen/adapters` barrel drags `node:fs`/`node:url`
 * (`product-lookup/fixture-paths.ts`'s `fileURLToPath(import.meta.url)`,
 * evaluated at module load, which Metro cannot bundle for React Native) into
 * the bundle" — filed as an M3-T3 blocker because nothing exercised it yet).
 * M3-T2 is the first ticket that actually wires a screen to this client (S1,
 * S2, Home), which makes that latent failure real: `pnpm --filter mobile
 * export` (a required acceptance check here) would break the moment any
 * screen imported `FixtureApiClient`, and the compiled client bundle would
 * carry domain ledger code, defeating the "mobile never imports domain"
 * invariant at the bundle level even though no source file names it. The fix
 * applied here, entirely inside this file's existing scope: the fixture
 * inventory and household data below are plain `@smart-kitchen/contracts`-
 * shaped literals, not built through domain functions or read through
 * `@smart-kitchen/adapters`. This is the same fix direction the M3-T1 review
 * proposed for M3-T3 ("switch the mobile fixture ApiClient ... to
 * contracts-shaped JSON ... and drop @smart-kitchen/adapters from
 * apps/mobile"), applied early because M3-T2's acceptance criteria require a
 * green `expo export` from a screen that now actually imports this client.
 * `packages/adapters`' own barrel and `@smart-kitchen/adapters` dependency
 * entry are untouched (out of this ticket's file scope); removing the now-
 * unused package.json/tsconfig reference is left for M3-T3 to close out.
 */

import type {
  HouseholdDto,
  InventoryItemSummary,
  MemberDto,
  MemberRestrictionDto,
  OnboardingStateDto,
} from "@smart-kitchen/contracts";

/** The Dean-Chen fixture token (tests/fixtures/identity/README.md). Obviously fake, not a secret. */
export const FIXTURE_IDENTITY_TOKEN = "fixture.dean.chen";

/** The one join code the fixture accepts (tests/fixtures/identity/README.md, BACKLOG.md M3-T2). */
export const FIXTURE_JOIN_CODE = "CHEN-482";

/** Exact copy for a join code that does not match (BACKLOG.md M3-T2 Objective (a)). */
export const JOIN_CODE_ERROR_MESSAGE =
  "That code didn't match a household. Check it with whoever invited you.";

const CHEN_HOUSEHOLD_ID = "hh-fixture-chen";

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

/** Contracts-shaped inventory fixture (see the file doc comment for why this is not adapters data). */
const FIXTURE_INVENTORY_ITEMS_CHEN: readonly InventoryItemSummary[] = [
  {
    itemId: "fixture-item-milk",
    householdId: CHEN_HOUSEHOLD_ID,
    name: "Whole milk",
    currentQty: { amount: 2, unit: "count" },
    storageLocation: "FRIDGE",
    quantityProvenanceTier: "KNOWN_FACT",
  },
  {
    itemId: "fixture-item-chicken",
    householdId: CHEN_HOUSEHOLD_ID,
    name: "Chicken breast",
    currentQty: { amount: 1.5, unit: "lb" },
    storageLocation: "FRIDGE",
    quantityProvenanceTier: "KNOWN_FACT",
  },
  {
    itemId: "fixture-item-rice",
    householdId: CHEN_HOUSEHOLD_ID,
    name: "Rice",
    currentQty: { amount: 900, unit: "g" },
    storageLocation: "PANTRY",
    quantityProvenanceTier: "KNOWN_FACT",
  },
];

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

export type JoinHouseholdResult =
  | { readonly ok: true; readonly household: HouseholdDto }
  | { readonly ok: false; readonly message: string };

/**
 * The seam between the mobile app and the API (M2-T1 onward). Everything the
 * client needs from the network goes through this port so a screen never
 * calls `fetch`/`axios` directly and swapping the fixture implementation for
 * a real HTTP client (once M2-T3's household endpoints exist) touches one
 * file.
 */
export interface ApiClient {
  /** The bearer token this client authenticates with. */
  getIdentityToken(): string;
  getInventoryItems(): Promise<readonly InventoryItemSummary[]>;
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
}

/**
 * Fixture implementation: no network call, ever, no persistence across app
 * restarts (in-memory for the session only, per BACKLOG.md M3-T2 Objective
 * (d)). Starts as a brand-new user (`household: null`) unless constructed via
 * {@link FixtureApiClient.returningUser}, which seeds a household whose S2
 * gate is already satisfied — the fixture's way of representing "returning
 * user" without a real persistence layer (out of scope this ticket).
 */
export class FixtureApiClient implements ApiClient {
  private household: HouseholdDto | null;
  /**
   * Creating a household starts an empty kitchen (true first run: "Your
   * kitchen is empty"). Joining CHEN-482 joins the Chen household Dean
   * already uses, which already has stock — the fixture's two create/join
   * paths deliberately land on Home's two different first-run states.
   */
  private inventoryPopulated: boolean;

  private constructor(initialHousehold: HouseholdDto | null, inventoryPopulated: boolean) {
    this.household = initialHousehold;
    this.inventoryPopulated = inventoryPopulated;
  }

  static newUser(): FixtureApiClient {
    return new FixtureApiClient(null, false);
  }

  /** A household whose S2 gate is already satisfied for every member (session-scoped, not persisted). */
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
      true,
    );
  }

  getIdentityToken(): string {
    return FIXTURE_IDENTITY_TOKEN;
  }

  getInventoryItems(): Promise<readonly InventoryItemSummary[]> {
    return Promise.resolve(
      this.household && this.inventoryPopulated ? FIXTURE_INVENTORY_ITEMS_CHEN : [],
    );
  }

  getOnboardingState(): Promise<OnboardingStateDto> {
    return Promise.resolve({ household: this.household });
  }

  signInWithEmail(): Promise<void> {
    return Promise.resolve();
  }

  createHousehold(name: string): Promise<HouseholdDto> {
    this.household = buildFixtureHousehold(name);
    this.inventoryPopulated = false;
    return Promise.resolve(this.household);
  }

  joinHousehold(code: string): Promise<JoinHouseholdResult> {
    if (code.trim() !== FIXTURE_JOIN_CODE) {
      return Promise.resolve({ ok: false, message: JOIN_CODE_ERROR_MESSAGE });
    }
    this.household = buildFixtureHousehold("The Chens");
    this.inventoryPopulated = true;
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
 * The module-level singleton every screen shares (M3-T2), so create/join in
 * S1 and the restrictions S2 saves are the same in-memory state the root
 * route reads back. Starts as a brand-new user; nothing in this app switches
 * it to `FixtureApiClient.returningUser()` today (there is no real sign-out /
 * relaunch to demonstrate it against without persistence), but it stays
 * exported for tests and for M3-T3 to swap for a real HTTP client behind the
 * same `apiClient` name.
 */
export const apiClient: ApiClient = FixtureApiClient.newUser();
