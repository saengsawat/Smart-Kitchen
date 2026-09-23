/**
 * Hand-written type declarations for `gen-screening-fixtures.mjs` (a plain
 * Node ESM script, not compiled TypeScript — `packages/adapters/scripts/`
 * sits outside this package's `tsconfig.json` `rootDir`/`include`, by
 * design, since it is a manual dev tool, not part of the package's build
 * output). This is the one file that gives
 * `screening-fixtures-consistency.test.ts`'s import of the `.mjs` module a
 * real type instead of an implicit `any`.
 */

import type { ScannedProductDto } from "@smart-kitchen/contracts";

export interface FixtureProductEntry {
  readonly productId: string;
  readonly code: string;
}

export const FIXTURE_PRODUCTS: readonly FixtureProductEntry[];
export const MISS_CODE: string;

export function generateScreeningFixtures(
  products?: readonly FixtureProductEntry[],
): Record<string, ScannedProductDto>;

export function generateManifest(
  products?: readonly FixtureProductEntry[],
): Record<string, string | null>;
