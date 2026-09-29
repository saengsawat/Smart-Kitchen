import { describe, expect, it } from "vitest";
import type { ShoppingListDto, ShoppingRowDto, ShoppingRowOriginDto } from "./shopping.js";

function baseRow(overrides: Partial<ShoppingRowDto> = {}): ShoppingRowDto {
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

describe("shopping contracts (M3-T5)", () => {
  it("accepts all three origin kinds", () => {
    const menu: ShoppingRowOriginDto = { kind: "menu", label: "Tonight", recipeName: null };
    const ai: ShoppingRowOriginDto = { kind: "ai", recipeName: "the stir-fry" };
    const member: ShoppingRowOriginDto = {
      kind: "member",
      memberId: "member-maya",
      initials: "MC",
      displayName: "Maya Chen",
    };
    expect(menu.kind).toBe("menu");
    expect(ai.kind).toBe("ai");
    expect(member.kind).toBe("member");
  });

  it("a row can be built with every field, itemId null for a not-yet-tracked item", () => {
    const row = baseRow({ itemId: null, status: "open" });
    expect(row.itemId).toBeNull();
  });

  it("a skip row can carry a null haveTier ('sufficient', no number licensed)", () => {
    const row = baseRow({ status: "skipped", haveTier: null, buyMicros: "0" });
    expect(row.haveTier).toBeNull();
    expect(row.buyMicros).toBe("0");
  });

  it("a full list carries rows, members and a syncedAt timestamp", () => {
    const list: ShoppingListDto = {
      rows: [baseRow()],
      members: [{ memberId: "member-dean", initials: "DC", displayName: "Dean Chen" }],
      syncedAt: "2026-09-29T12:00:00.000Z",
    };
    expect(list.rows).toHaveLength(1);
    expect(list.members[0]?.initials).toBe("DC");
  });
});
