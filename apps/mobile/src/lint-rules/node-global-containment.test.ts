import { Linter } from "eslint";
import tseslint from "typescript-eslint";
import { describe, expect, it } from "vitest";

/**
 * Proves the `no-restricted-globals` rule added to `eslint.config.js`
 * (M3-T2 review F3) actually rejects a reference to `process`/`Buffer`/
 * `__dirname`/`__filename`/`global` as a *global* in ordinary apps/mobile
 * source, and still allows a locally declared identifier of the same name
 * (which shadows the global rather than being it) — the exact pattern
 * `domain-boundary.test.ts`'s own `declare const process` and
 * `copy-scan.test.ts`'s real Node usage both rely on.
 *
 * This is the same rule config `eslint.config.js` applies (restated here,
 * the same pattern `domain-boundary.test.ts` uses to verify a rule against
 * an in-memory source string rather than an on-disk fixture).
 */
const RESTRICTED_GLOBAL_NAMES = ["process", "Buffer", "__dirname", "__filename", "global"] as const;

function lint(code: string): ReturnType<Linter["verify"]> {
  const linter = new Linter();
  return linter.verify(code, {
    languageOptions: { parser: tseslint.parser, ecmaVersion: "latest", sourceType: "module" },
    rules: {
      "no-restricted-globals": [
        "error",
        ...RESTRICTED_GLOBAL_NAMES.map((name) => ({
          name,
          message: "Node global; apps/mobile keeps Node's ambient globals out of app code.",
        })),
      ],
      "no-restricted-properties": [
        "error",
        ...RESTRICTED_GLOBAL_NAMES.map((property) => ({
          object: "globalThis",
          property,
          message:
            "Node global reached through globalThis; apps/mobile keeps them out of app code.",
        })),
      ],
    },
  });
}

describe("apps/mobile Node-global containment rule (no-restricted-globals, M3-T2 review F3)", () => {
  it.each(RESTRICTED_GLOBAL_NAMES)("rejects a bare reference to the global %s", (name) => {
    const messages = lint(`export const x = ${name};\n`);
    expect(messages.some((m) => m.ruleId === "no-restricted-globals")).toBe(true);
  });

  it("rejects process.cwd() used as the ambient global", () => {
    const messages = lint("export const x = process.cwd();\n");
    expect(messages.some((m) => m.ruleId === "no-restricted-globals")).toBe(true);
  });

  it("does not flag a locally declared identifier that shadows the global name", () => {
    const messages = lint(
      "declare const process: { cwd(): string };\nexport const x = process.cwd();\n",
    );
    expect(messages.filter((m) => m.ruleId === "no-restricted-globals")).toEqual([]);
  });

  it("does not flag ordinary code with none of the restricted names", () => {
    const messages = lint('export const x = "No known allergies for Maya";\n');
    expect(messages).toEqual([]);
  });

  describe("member access through globalThis (review F19)", () => {
    it.each(RESTRICTED_GLOBAL_NAMES)("rejects globalThis.%s", (name) => {
      const messages = lint(`export const x = globalThis.${name};\n`);
      expect(messages.some((m) => m.ruleId === "no-restricted-properties")).toBe(true);
    });

    it("still allows an unrelated globalThis property (e.g. fetch mocking in client.test.ts)", () => {
      const messages = lint("export const x = globalThis.fetch;\n");
      expect(messages).toEqual([]);
    });
  });
});
