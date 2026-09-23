import { describe, expect, it } from "vitest";
import { CENTER_ACTION, TAB_ORDER, isActiveRoute } from "./tabs";

describe("TAB_ORDER (five-slot shell, M3-T1 acceptance criteria)", () => {
  it("has exactly four bottom-bar slots plus the centre action makes five", () => {
    expect(TAB_ORDER).toHaveLength(4);
  });

  it("orders Home, Inventory, Menu, Shopping left to right (prototype v4 .nav)", () => {
    expect(TAB_ORDER.map((t) => t.key)).toEqual(["home", "inventory", "menu", "shopping"]);
  });

  it("labels the fourth slot Menu with a calendar-style icon (D-020)", () => {
    const menu = TAB_ORDER[2];
    expect(menu?.label).toBe("Menu");
    expect(menu?.icon).toBe("calendar");
  });

  it("every route is unique and starts with /", () => {
    const routes = TAB_ORDER.map((t) => t.route);
    expect(new Set(routes).size).toBe(routes.length);
    for (const route of routes) {
      expect(route.startsWith("/")).toBe(true);
    }
  });

  it("Inventory and Shopping point at their M3-Tn ticket; Home and Menu are held (OQ-D9/D-020)", () => {
    expect(TAB_ORDER.find((t) => t.key === "home")?.placeholder).toBe(
      "Full dashboard held pending Dean's review (OQ-D9).",
    );
    expect(TAB_ORDER.find((t) => t.key === "inventory")?.placeholder).toBe("Coming in M3-T3.");
    expect(TAB_ORDER.find((t) => t.key === "shopping")?.placeholder).toBe("Coming in M3-T5.");
    expect(TAB_ORDER.find((t) => t.key === "menu")?.placeholder).toBe(
      "Held until D-020 is ratified.",
    );
  });

  it("no placeholder copy contains an em dash (P11)", () => {
    for (const tab of TAB_ORDER) {
      expect(tab.placeholder).not.toContain("—");
      expect(tab.label).not.toContain("—");
    }
  });
});

describe("CENTER_ACTION (the FAB scan button)", () => {
  it("opens the real Add hub (M3-T4b: S6-S9, no longer a placeholder)", () => {
    expect(CENTER_ACTION.route).toBe("/add");
  });

  it("is not one of the four flex-row tabs", () => {
    expect(TAB_ORDER.some((t) => t.route === CENTER_ACTION.route)).toBe(false);
  });
});

describe("isActiveRoute", () => {
  it("matches Home only at the root path", () => {
    expect(isActiveRoute("/", "/")).toBe(true);
    expect(isActiveRoute("", "/")).toBe(true);
    expect(isActiveRoute("/inventory", "/")).toBe(false);
  });

  it("matches a tab's own path and its sub-paths", () => {
    expect(isActiveRoute("/inventory", "/inventory")).toBe(true);
    expect(isActiveRoute("/inventory/item-1", "/inventory")).toBe(true);
    expect(isActiveRoute("/shopping", "/inventory")).toBe(false);
  });
});
