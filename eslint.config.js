// @ts-check
import path from "node:path";
import { fileURLToPath } from "node:url";
import js from "@eslint/js";
import { flatConfigs as importXFlatConfigs } from "eslint-plugin-import-x";
import { createTypeScriptImportResolver } from "eslint-import-resolver-typescript";
import eslintConfigPrettier from "eslint-config-prettier";
import globals from "globals";
import tseslint from "typescript-eslint";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const domainDir = path.join(__dirname, "packages/domain");

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/*.tsbuildinfo",
      "**/coverage/**",
      "pnpm-lock.yaml",
    ],
  },
  js.configs.recommended,
  importXFlatConfigs.recommended,
  {
    // Type-aware linting for real workspace source; root-level tooling
    // config files (this file, vitest.config.ts) are plain TS/JS and are
    // covered by the non-type-checked rules from js.configs.recommended +
    // typescript-eslint's syntax-only parsing below instead — they aren't
    // part of any package's tsconfig "include".
    files: ["apps/**/*.ts", "packages/**/*.ts"],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: __dirname,
      },
    },
  },
  {
    files: ["*.ts", "*.js"],
    extends: [...tseslint.configs.recommended],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    settings: {
      // TS-aware resolution: understands NodeNext's "./foo.js" -> "./foo.ts"
      // extension mapping and workspace-package resolution, which the plain
      // Node resolver cannot — required for no-restricted-paths below to
      // actually resolve the boundary-check zones.
      "import-x/resolver-next": [createTypeScriptImportResolver()],
    },
  },
  // --- Dependency-boundary rule (M0-T1) ---
  // packages/domain is the deterministic core (ARCHITECTURE.md §2,
  // CLAUDE.md rule 7): zero runtime dependencies, zero I/O, no imports from
  // adapters or contracts. Scoped to domain's production source only (its
  // *.test.ts files legitimately depend on the shared vitest devDependency,
  // which is not a boundary concern). Enforced three ways:
  //  1. no-extraneous-dependencies — domain/package.json declares zero
  //     dependencies, so ANY bare-specifier import (an npm package, or a
  //     sibling workspace package like @smart-kitchen/adapters) is flagged.
  //  2. no-restricted-paths — belt-and-suspenders guard against a relative
  //     path reaching into adapters/contracts source directly.
  //  3. no-nodejs-modules — blocks Node built-ins (fs, net, …), which are
  //     not "dependencies" and so wouldn't be caught by rule 1 alone.
  {
    files: ["packages/domain/src/**/*.ts"],
    ignores: ["packages/domain/src/**/*.test.ts"],
    rules: {
      "import-x/no-extraneous-dependencies": ["error", { packageDir: domainDir }],
      "import-x/no-nodejs-modules": "error",
      "import-x/no-restricted-paths": [
        "error",
        {
          zones: [
            {
              target: "./packages/domain/src",
              from: ["./packages/adapters/src", "./packages/contracts/src"],
              message:
                "packages/domain must not depend on adapters or contracts — it is the pure, zero-I/O core (ARCHITECTURE.md §2, CLAUDE.md rule 7).",
            },
          ],
        },
      ],
    },
  },
  eslintConfigPrettier,
);
