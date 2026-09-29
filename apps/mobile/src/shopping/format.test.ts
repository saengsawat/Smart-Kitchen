import { describe, expect, it } from "vitest";
import type { ShoppingRowDto } from "@smart-kitchen/contracts";
import {
  doneRowStatusText,
  formatShoppingAmount,
  menuOriginText,
  openRowOriginText,
  skipRowAmountText,
} from "./format";

const MEMBERS = [
  { memberId: "member-dean", initials: "DC", displayName: "Dean Chen" },
  { memberId: "member-maya", initials: "MC", displayName: "Maya Chen" },
];

function row(overrides: Partial<ShoppingRowDto> = {}): ShoppingRowDto {
  return {
    rowId: "row-1",
    name: "Chicken breast",
    group: "Meat & seafood",
    origin: { kind: "menu", label: "Tonight", recipeName: null },
    needMicros: "2000000",
    haveMicros: "1250000",
    haveTier: "KNOWN_FACT",
    buyMicros: "750000",
    unit: "lb",
    itemId: "fixture-item-chicken",
    status: "open",
    checkedOffBy: null,
    defaultLocation: "FRIDGE",
    ...overrides,
  };
}

describe("formatShoppingAmount", () => {
  it("renders a plain unit amount from exact micros", () => {
    expect(formatShoppingAmount("750000", "lb", null)).toBe("0.75 lb");
    expect(formatShoppingAmount("2000000", "lb", null)).toBe("2 lb");
  });

  it("prefixes ~ for an ESTIMATED tier", () => {
    expect(formatShoppingAmount("4000000", "cup", "ESTIMATED")).toBe("~4 cups");
  });

  it("never prefixes ~ for KNOWN_FACT or null", () => {
    expect(formatShoppingAmount("4000000", "cup", "KNOWN_FACT")).toBe("4 cups");
    expect(formatShoppingAmount("4000000", "cup", null)).toBe("4 cups");
  });

  it("renders a count-kind (each) amount bare, no unit word", () => {
    expect(formatShoppingAmount("1000000", "each", null)).toBe("1");
    expect(formatShoppingAmount("2000000", "each", null)).toBe("2");
  });

  it("singular cup does not pluralize", () => {
    expect(formatShoppingAmount("1000000", "cup", null)).toBe("1 cup");
  });
});

describe("menuOriginText", () => {
  it("partial stock: need/have numeric form, recipe name omitted even if present", () => {
    const text = menuOriginText(
      { kind: "menu", label: "Tonight", recipeName: "stir-fry" },
      "2000000",
      "1250000",
      "lb",
    );
    expect(text).toBe("need 2 lb · have 1.25 lb");
  });

  it("zero stock with a recipe name: recipe name plus none on hand", () => {
    const text = menuOriginText(
      { kind: "menu", label: "Weekend menu", recipeName: "miso salmon" },
      "2000000",
      "0",
      "lb",
    );
    expect(text).toBe("miso salmon · none on hand");
  });

  it("zero stock, no recipe name: bare need amount", () => {
    const text = menuOriginText(
      { kind: "menu", label: "This week", recipeName: null },
      "3000000",
      "0",
      "cup",
    );
    expect(text).toBe("need 3 cups");
  });
});

describe("openRowOriginText", () => {
  it("dispatches an AI row to its verbatim template", () => {
    const text = openRowOriginText(row({ origin: { kind: "ai", recipeName: "the stir-fry" } }));
    expect(text).toBe("suggested to go with the stir-fry · a proposal until you keep it");
  });

  it("dispatches a member row to its verbatim template", () => {
    const text = openRowOriginText(
      row({
        origin: {
          kind: "member",
          memberId: "member-maya",
          initials: "MC",
          displayName: "Maya Chen",
        },
      }),
    );
    expect(text).toBe("added by Maya Chen · not tied to a menu");
  });
});

describe("doneRowStatusText", () => {
  it("null for an open row", () => {
    expect(doneRowStatusText(row({ status: "open" }), MEMBERS)).toBeNull();
  });

  it("added and checked off by X when the same member added and checked it off", () => {
    const text = doneRowStatusText(
      row({
        status: "done",
        checkedOffBy: "DC",
        origin: {
          kind: "member",
          memberId: "member-dean",
          initials: "DC",
          displayName: "Dean Chen",
        },
      }),
      MEMBERS,
    );
    expect(text).toBe("added and checked off by Dean Chen");
  });

  it("checked off by X when a different member (or non-member origin) checked it off", () => {
    const text = doneRowStatusText(
      row({
        status: "done",
        checkedOffBy: "DC",
        origin: { kind: "menu", label: "Tonight", recipeName: null },
      }),
      MEMBERS,
    );
    expect(text).toBe("checked off by Dean Chen");
  });
});

describe("skipRowAmountText", () => {
  it("renders the tiered amount when haveTier is set", () => {
    const text = skipRowAmountText(
      row({ status: "skipped", haveMicros: "4000000", haveTier: "ESTIMATED", unit: "cup" }),
    );
    expect(text).toBe("~4 cups");
  });

  it("renders 'sufficient' with no number when haveTier is null", () => {
    const text = skipRowAmountText(row({ status: "skipped", haveTier: null }));
    expect(text).toBe("sufficient");
  });
});
