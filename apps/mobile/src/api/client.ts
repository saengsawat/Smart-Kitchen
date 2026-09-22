/**
 * `ApiClient` port + fixture implementation (M3-T1).
 *
 * Only `@smart-kitchen/contracts` DTOs cross this boundary (M3-T1 invariant:
 * `apps/mobile` never imports `@smart-kitchen/domain`). No network call is
 * made anywhere in this file; the fixture identity token and inventory rows
 * come from `@smart-kitchen/adapters`' fixture data
 * (tests/fixtures/identity/README.md documents the token strings, which
 * M2-T1 adopts).
 */

import { FIXTURE_INVENTORY_ITEMS_CHEN } from "@smart-kitchen/adapters";
import type { InventoryItemSummary } from "@smart-kitchen/contracts";

/** The Dean-Chen fixture token (tests/fixtures/identity/README.md). Obviously fake, not a secret. */
export const FIXTURE_IDENTITY_TOKEN = "fixture.dean.chen";

/**
 * The seam between the mobile app and the API (M2-T1 onward). Everything the
 * client needs from the network goes through this port so a screen never
 * calls `fetch`/`axios` directly and swapping the fixture implementation for
 * a real HTTP client (once M2-T1's endpoint exists) touches one file.
 */
export interface ApiClient {
  /** The bearer token this client authenticates with. */
  getIdentityToken(): string;
  getInventoryItems(): Promise<readonly InventoryItemSummary[]>;
}

/**
 * Fixture implementation: no network call, ever. Returns the Chen household's
 * fixture inventory (`@smart-kitchen/adapters`) under the fixture identity
 * token. This is what every M3 screen reads from until M2-T1's endpoint
 * lands and a real HTTP `ApiClient` replaces it (BACKLOG.md M3 epic note:
 * "until an endpoint exists, screens read from packages/adapters fixtures
 * behind the same client port").
 */
export class FixtureApiClient implements ApiClient {
  getIdentityToken(): string {
    return FIXTURE_IDENTITY_TOKEN;
  }

  getInventoryItems(): Promise<readonly InventoryItemSummary[]> {
    return Promise.resolve(FIXTURE_INVENTORY_ITEMS_CHEN);
  }
}
