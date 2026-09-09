/**
 * `@smart-kitchen/domain` — the deterministic core.
 *
 * Pure TypeScript: zero runtime dependencies, zero I/O, no clock, no
 * randomness (ARCHITECTURE.md §2, CLAUDE.md rule 7; enforced by the
 * dependency-boundary lint in `eslint.config.js`). Safety-critical arithmetic
 * lives here and nowhere else.
 *
 * Modules:
 * - `inventory` — the append-only inventory ledger (M1-T1, ADR-008).
 */

export const DOMAIN_PACKAGE_NAME = "@smart-kitchen/domain";

export * from "./inventory/index.js";
