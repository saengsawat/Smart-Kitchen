import { Linter } from "eslint";
import { flatConfigs as importXFlatConfigs } from "eslint-plugin-import-x";
import tseslint from "typescript-eslint";
import { describe, expect, it } from "vitest";

/**
 * apps/mobile's tsconfig sets `"types": []` so Node's ambient globals never
 * leak into React Native app code, which means `process` has no type here
 * even though this test file genuinely runs under Node (via vitest). Rather
 * than pull in all of `@types/node` project-wide for one test file's use of
 * `process.cwd()`, declare only the one shape actually needed.
 */
declare const process: { cwd(): string };

/**
 * Proves the apps/mobile domain-boundary rules (root eslint.config.js)
 * actually reject an import of `@smart-kitchen/domain`, in every form the
 * review of this ticket checked, and still allow `@smart-kitchen/contracts`
 * and `@smart-kitchen/adapters` (M3-T1 invariant: "the domain package is
 * never imported by UI code except through packages/contracts types").
 *
 * Two rules, tested separately, both run against in-memory source strings
 * (no fixture file on disk, so nothing here is accidentally swept into the
 * real `pnpm lint` run or `tsc` build):
 *
 * 1. `no-restricted-imports` (a core ESLint rule, no plugin needed) catches
 *    the bare specifier and any deep import into it. Needs no filesystem
 *    resolution, so it is tested with a bare `Linter` and no `filename`.
 * 2. `import-x/no-restricted-paths` catches a *relative* path reaching
 *    straight into `packages/domain/src` (M3-T1 review finding F1: rule 1
 *    alone does not see `import { x } from "../../../../packages/domain/
 *    src/inventory/ledger"`, which lints and typechecks clean without it).
 *    This one needs real path resolution against the actual
 *    `packages/domain/src` on disk, so the test passes a `filename` inside
 *    the real `apps/mobile/src` tree (the file itself does not need to
 *    exist; only the resolved import target does, and it does).
 */

const DOMAIN_BOUNDARY_RULE_CONFIG = [
  "error",
  {
    paths: [
      {
        name: "@smart-kitchen/domain",
        message:
          "apps/mobile must not import @smart-kitchen/domain directly. Use @smart-kitchen/contracts types instead (M3-T1 invariant).",
      },
    ],
    patterns: [
      {
        group: ["@smart-kitchen/domain/*"],
        message:
          "apps/mobile must not import @smart-kitchen/domain directly. Use @smart-kitchen/contracts types instead (M3-T1 invariant).",
      },
    ],
  },
] as const;

function lintImportSpecifier(code: string): ReturnType<Linter["verify"]> {
  const linter = new Linter();
  return linter.verify(code, {
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: "latest",
      sourceType: "module",
    },
    rules: {
      "no-restricted-imports": DOMAIN_BOUNDARY_RULE_CONFIG as unknown as Linter.RuleEntry,
    },
  });
}

describe("apps/mobile domain-boundary rule: no-restricted-imports (specifier)", () => {
  it("rejects a bare import of @smart-kitchen/domain", () => {
    const messages = lintImportSpecifier(
      'import { createInventoryItem } from "@smart-kitchen/domain";\nexport {};\n',
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]?.ruleId).toBe("no-restricted-imports");
  });

  it("rejects a deep import into @smart-kitchen/domain", () => {
    const messages = lintImportSpecifier(
      'import { createInventoryItem } from "@smart-kitchen/domain/inventory/ledger.js";\nexport {};\n',
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]?.ruleId).toBe("no-restricted-imports");
  });

  it("allows @smart-kitchen/contracts", () => {
    const messages = lintImportSpecifier(
      'import type { InventoryItemSummary } from "@smart-kitchen/contracts";\nexport {};\n',
    );
    expect(messages).toHaveLength(0);
  });

  it("allows @smart-kitchen/adapters (the fixture data, not domain internals)", () => {
    const messages = lintImportSpecifier(
      'import { FIXTURE_INVENTORY_ITEMS_CHEN } from "@smart-kitchen/adapters";\nexport {};\n',
    );
    expect(messages).toHaveLength(0);
  });
});

// --- import-x/no-restricted-paths (relative path into packages/domain/src) ---

/**
 * `filename` is a path inside the real `apps/mobile/src` tree (repo-root
 * relative, e.g. "apps/mobile/src/api/virtual.ts"); the file need not exist
 * on disk for the rule to fire (only the *resolved import target* needs to,
 * so this exercises real resolution against the real packages/domain/src
 * without adding an on-disk fixture file at all). `process.cwd()` is the
 * repo root: vitest always runs from there (see vitest.config.ts), and
 * nothing in this file changes the working directory.
 */
/**
 * ESLint's own `Linter.Config` / `Linter.Plugin` type names are not
 * resolvable from outside the "eslint" package (a quirk of how its .d.ts
 * merges the `Linter` namespace: referencing `Linter.Plugin` directly gives
 * TS2694 "has no exported member"). `Parameters<Linter["verify"]>[1]`
 * derives the same type structurally, from the callable signature itself,
 * without needing to name it.
 */
type LinterConfig = Parameters<Linter["verify"]>[1];

function lintRestrictedPath(code: string, filename: string): ReturnType<Linter["verify"]> {
  const cwd = process.cwd();
  const linter = new Linter({ cwd });
  // Reuses import-x's own blessed plugin registration (the same object
  // eslint.config.js itself spreads in) instead of hand-building a
  // "plugins" record: eslint-plugin-import-x ships its own flat-config
  // types (a real, structurally equivalent flat config, just typed against
  // its own "Plugins"/"FlatConfig" aliases rather than eslint's own, so
  // TS's structural check does not unify them). The final `as LinterConfig`
  // is a same-shape assertion across those two type packages, not an
  // escape from an actual mismatch; this is proven correct at runtime by
  // every test below.
  const config = {
    ...importXFlatConfigs.recommended,
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: "latest",
      sourceType: "module",
    },
    settings: {
      "import-x/resolver": {
        typescript: { alwaysTryTypes: true },
      },
    },
    rules: {
      "import-x/no-restricted-paths": [
        "error",
        {
          zones: [
            {
              target: ["./apps/mobile/src", "./apps/mobile/app"],
              from: ["./packages/domain/src"],
              message:
                "apps/mobile must not reach into packages/domain/src by relative path. Use @smart-kitchen/contracts types instead (M3-T1 invariant).",
            },
          ],
        },
      ],
    },
  } as LinterConfig;
  return linter.verify(code, config, { filename: `${cwd}/${filename}` });
}

describe("apps/mobile domain-boundary rule: import-x/no-restricted-paths (relative path, F1)", () => {
  it("rejects a relative import from apps/mobile/src straight into packages/domain/src", () => {
    const messages = lintRestrictedPath(
      'import { createInventoryItem } from "../../../../packages/domain/src/inventory/ledger";\nexport const x = createInventoryItem;\n',
      "apps/mobile/src/api/virtual.ts",
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]?.ruleId).toBe("import-x/no-restricted-paths");
  });

  it("rejects the same relative reach from apps/mobile/app", () => {
    const messages = lintRestrictedPath(
      'import { createInventoryItem } from "../../../packages/domain/src/inventory/ledger";\nexport const x = createInventoryItem;\n',
      "apps/mobile/app/virtual.tsx",
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]?.ruleId).toBe("import-x/no-restricted-paths");
  });

  it("allows a relative import that stays inside apps/mobile/src", () => {
    const messages = lintRestrictedPath(
      'import { colors } from "../design/tokens";\nexport const x = colors;\n',
      "apps/mobile/src/api/virtual.ts",
    );
    expect(messages.filter((m) => m.ruleId === "import-x/no-restricted-paths")).toHaveLength(0);
  });
});
