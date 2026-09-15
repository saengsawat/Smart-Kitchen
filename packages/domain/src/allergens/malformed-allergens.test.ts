/**
 * M1-T6 — structurally malformed allergen containers fail closed.
 *
 * The M1-T4 review left one fail-open path open (`docs/handoff/M1-T4.review.md`,
 * "Mandatory pre-M4 follow-up"): `allergens` arriving as `"peanut"`, `5`, `{}`
 * or `["peanut"]` was coerced to "no assertions", so under a valid sourced
 * `KNOWN_FACT` declaration the locus reached `ALLOWED` — the engine concluded
 * *no known match* from data it had never read.
 *
 * Every test here therefore pins the same distinction:
 *
 * | Field | Meaning | Verdict under a full declaration |
 * |---|---|---|
 * | absent / `[]` | nothing was claimed — honest | `ALLOWED` |
 * | present but unreadable | data we hold and cannot interpret | `ALLOWED_WITH_UNKNOWNS` |
 *
 * The matrix runs every malformed shape across both loci (`PRODUCT`,
 * `RECIPE_INGREDIENT`) and both restriction kinds (`MAJOR`, `USER_DEFINED`),
 * always under `fullDeclaration()` — i.e. every test subject would screen
 * `ALLOWED` if the malformation were ignored, which is what makes each of them
 * kill the mutation (see the mutation table in `docs/handoff/M1-T6.worker.md`).
 */

import { describe, expect, it } from "vitest";

import { screenSubject, type ScreeningResult } from "./index.js";
import {
  contains,
  expectScreened,
  fullDeclaration,
  majorRestrictionOf,
  mayContain,
  memberWith,
  uniqueSorted,
  userTermRestriction,
} from "./test-support.js";

/** Neither the name nor the ingredient statement mentions any allergen term. */
const NAME = "Bottled Spring Water";
const INGREDIENTS_TEXT = "water, mineral salts";

/** A product locus whose `allergens` field is whatever the case supplies. */
function productWith(allergens: unknown): never {
  return {
    kind: "PRODUCT",
    subjectId: "p1",
    name: NAME,
    ingredientsText: INGREDIENTS_TEXT,
    allergens,
    declaration: fullDeclaration(),
  } as never;
}

/** The same, as a single recipe ingredient locus. */
function recipeWith(allergens: unknown): never {
  return {
    kind: "RECIPE",
    subjectId: "r1",
    ingredients: [
      {
        ref: NAME,
        ingredientsText: INGREDIENTS_TEXT,
        allergens,
        declaration: fullDeclaration(),
      },
    ],
  } as never;
}

const LOCI = [["PRODUCT", productWith] as const, ["RECIPE_INGREDIENT", recipeWith] as const];

const RESTRICTIONS = [
  ["MAJOR severe", memberWith("m1", majorRestrictionOf("r1", "peanut", "severe"))] as const,
  ["MAJOR standard", memberWith("m1", majorRestrictionOf("r1", "peanut", "standard"))] as const,
  ["USER_DEFINED severe", memberWith("m1", userTermRestriction("r1", "mango", "severe"))] as const,
  [
    "USER_DEFINED standard",
    memberWith("m1", userTermRestriction("r1", "mango", "standard")),
  ] as const,
];

/** Present-but-not-an-array containers, with the shape the detail must name. */
const MALFORMED_CONTAINERS: readonly (readonly [string, unknown, string])[] = [
  ["string", "peanut", "allergens is a string, expected an array"],
  ["number", 5, "allergens is a number, expected an array"],
  ["boolean", true, "allergens is a boolean, expected an array"],
  ["empty object", {}, "allergens is an object, expected an array"],
  [
    "object shaped like a list",
    { 0: { allergenCode: "peanut", assertion: "CONTAINS" }, length: 1 },
    "allergens is an object, expected an array",
  ],
  ["null", null, "allergens is null, expected an array"],
];

/** Arrays whose first element is not an assertion object. */
const MALFORMED_ELEMENTS: readonly (readonly [string, unknown, string])[] = [
  ["string entry", ["peanut"], "allergens[0] is a string, expected an assertion object"],
  ["null entry", [null], "allergens[0] is null, expected an assertion object"],
  ["number entry", [5], "allergens[0] is a number, expected an assertion object"],
  ["boolean entry", [false], "allergens[0] is a boolean, expected an assertion object"],
  ["nested array entry", [["peanut"]], "allergens[0] is an array, expected an assertion object"],
];

const MALFORMED_SHAPES = [...MALFORMED_CONTAINERS, ...MALFORMED_ELEMENTS];

function assertFailsClosed(result: ScreeningResult, expectedDetail: string, part: string): void {
  expect(result.verdict).toBe("ALLOWED_WITH_UNKNOWNS");
  expect(result.unknowns.length).toBeGreaterThan(0);
  expect(uniqueSorted(result.unknowns.map((u) => u.reason))).toEqual(["MALFORMED_ALLERGEN_DATA"]);
  expect(result.unknowns[0]?.detail).toBe(expectedDetail);
  expect(result.unknowns[0]?.locus.part).toBe(part);
  expect(result.warnings.map((w) => w.code)).toContain("UNRECOGNIZED_ALLERGEN_DATA");
  expect(result.evidence).toEqual([]);
}

describe("M1-T6 matrix: malformed allergen data never licenses ALLOWED", () => {
  for (const [locusName, subjectOf] of LOCI) {
    for (const [restrictionName, member] of RESTRICTIONS) {
      for (const [shapeName, allergens, expectedDetail] of MALFORMED_SHAPES) {
        it(`${locusName} · ${restrictionName} · ${shapeName}`, () => {
          const result = expectScreened(
            screenSubject({ subject: subjectOf(allergens), members: [member] }),
          );
          assertFailsClosed(result, expectedDetail, locusName);
        });
      }
    }
  }
});

describe("M1-T6 control: the same subjects reach ALLOWED once the field is honest", () => {
  for (const [locusName, subjectOf] of LOCI) {
    for (const [restrictionName, member] of RESTRICTIONS) {
      it(`${locusName} · ${restrictionName} · empty list`, () => {
        const result = expectScreened(screenSubject({ subject: subjectOf([]), members: [member] }));
        expect(result.verdict).toBe("ALLOWED");
        expect(result.unknowns).toEqual([]);
        expect(result.warnings.map((w) => w.code)).not.toContain("UNRECOGNIZED_ALLERGEN_DATA");
      });

      it(`${locusName} · ${restrictionName} · field absent`, () => {
        const result = expectScreened(
          screenSubject({ subject: subjectOf(undefined), members: [member] }),
        );
        expect(result.verdict).toBe("ALLOWED");
        expect(result.unknowns).toEqual([]);
      });
    }
  }
});

describe("M1-T6: a malformed entry never hides a well-formed one", () => {
  const mixtures: readonly (readonly [string, readonly unknown[]])[] = [
    ["malformed after the assertion", [contains("peanut"), null]],
    ["malformed before the assertion", [null, contains("peanut")]],
    ["malformed either side", ["peanut", contains("peanut"), 5]],
  ];

  for (const [label, allergens] of mixtures) {
    for (const [locusName, subjectOf] of LOCI) {
      it(`${locusName} · ${label} · still BLOCKS`, () => {
        const result = expectScreened(
          screenSubject({
            subject: subjectOf(allergens),
            members: [memberWith("m1", majorRestrictionOf("r1", "peanut", "severe"))],
          }),
        );
        expect(result.verdict).toBe("BLOCKED");
        expect(result.evidence.map((e) => e.kind)).toContain("ASSERTION_CONTAINS");
      });
    }
  }

  it("keeps a severe cross-contact block intact beside malformed data", () => {
    const result = expectScreened(
      screenSubject({
        subject: productWith([null, mayContain("peanut")]),
        members: [memberWith("m1", majorRestrictionOf("r1", "peanut", "severe"))],
      }),
    );
    // CROSS_CONTACT_POLICY.severe === "BLOCK" — unchanged by this ticket.
    expect(result.verdict).toBe("BLOCKED");
    expect(result.warnings.map((w) => w.code)).toContain("CROSS_CONTACT_SEVERE");
  });

  it("reports the offending index, not merely that something was wrong", () => {
    const result = expectScreened(
      screenSubject({
        subject: productWith([contains("milk"), null, 5]),
        members: [memberWith("m1", majorRestrictionOf("r1", "peanut", "standard"))],
      }),
    );
    expect(result.verdict).toBe("ALLOWED_WITH_UNKNOWNS");
    expect(result.unknowns[0]?.reason).toBe("MALFORMED_ALLERGEN_DATA");
    expect(result.unknowns[0]?.detail).toBe("allergens[1] is null, expected an assertion object");
  });
});

describe("M1-T6: severe allergies still raise the critical warning on malformed data", () => {
  it("adds SEVERE_ALLERGY_UNKNOWN_DATA when the container is unreadable", () => {
    const result = expectScreened(
      screenSubject({
        subject: productWith("peanut, milk"),
        members: [memberWith("m1", majorRestrictionOf("r1", "peanut", "severe"))],
      }),
    );
    expect(result.warnings.map((w) => w.code)).toContain("SEVERE_ALLERGY_UNKNOWN_DATA");
    expect(result.warnings.map((w) => w.code)).toContain("UNRECOGNIZED_ALLERGEN_DATA");
  });
});

describe("M1-T6: screenSubject stays total across the malformed matrix", () => {
  const exotic: readonly unknown[] = [
    ...MALFORMED_SHAPES.map(([, value]) => value),
    () => "peanut",
    new Date(0),
    new Map([["peanut", true]]),
    Number.NaN,
    [Symbol("peanut")],
    [() => "peanut"],
    [new Date(0)],
    [undefined],
  ];

  for (const [index, allergens] of exotic.entries()) {
    it(`returns a verdict rather than throwing: case ${String(index)}`, () => {
      for (const [, subjectOf] of LOCI) {
        const call = () =>
          screenSubject({
            subject: subjectOf(allergens),
            members: [memberWith("m1", majorRestrictionOf("r1", "peanut", "severe"))],
          });
        expect(call).not.toThrow();
        expect(expectScreened(call()).verdict).not.toBe("ALLOWED");
      }
    });
  }
});

describe("M1-T6: uninterpretable data is still uninterpretable for user-defined terms", () => {
  it("does not read a malformed container as text to scan", () => {
    // `allergens: "mango"` is not an ingredient statement and is not evidence:
    // it is unreadable data. The honest answer is unknown, not a match — and
    // certainly not ALLOWED.
    const result = expectScreened(
      screenSubject({
        subject: productWith("mango"),
        members: [memberWith("m1", userTermRestriction("r1", "mango", "standard"))],
      }),
    );
    expect(result.verdict).toBe("ALLOWED_WITH_UNKNOWNS");
    expect(result.unknowns[0]?.reason).toBe("MALFORMED_ALLERGEN_DATA");
    expect(result.evidence).toEqual([]);
  });
});
