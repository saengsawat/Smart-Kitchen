/**
 * S4's load call, pulled out of the screen component so its failure path is
 * unit-testable without a component renderer (review F5: "cold-start
 * offline leaves a blank screen forever" was undetected because nothing
 * exercised `apiClient.getInventoryItems()` rejecting on a first load, with
 * no prior cache to fall back to).
 */

import type { InventoryItemSummaryDto } from "@smart-kitchen/contracts";

/** The two `ApiClient` methods this call needs; kept narrow so a test can pass a minimal fake. */
export interface InventoryListSource {
  getInventoryItems(): Promise<readonly InventoryItemSummaryDto[]>;
  isInventoryStale(): boolean;
}

export type LoadInventoryResult =
  | {
      readonly ok: true;
      readonly items: readonly InventoryItemSummaryDto[];
      readonly stale: boolean;
    }
  | { readonly ok: false };

/**
 * Never rejects: a `getInventoryItems()` rejection (no cache to fall back to,
 * `src/api/client.ts`'s `HttpApiClient`) becomes `{ ok: false }` instead of
 * an unhandled rejection the screen's `useEffect` would otherwise drop
 * silently, leaving `items` stuck at `null` forever.
 */
export async function loadInventoryList(client: InventoryListSource): Promise<LoadInventoryResult> {
  try {
    const items = await client.getInventoryItems();
    return { ok: true, items, stale: client.isInventoryStale() };
  } catch {
    return { ok: false };
  }
}
