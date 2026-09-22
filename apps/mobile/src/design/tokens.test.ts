import { describe, expect, it } from "vitest";
import { colors, radius, spacing } from "./tokens";

/**
 * Pins every D-021 hex verbatim against prototype v4's `:root` block
 * (docs/design/mockups/smart-kitchen-prototype.html lines 12-37) and
 * docs/design/tokens.md §1, so a drift in either place is caught here.
 */
describe("colors (D-021 palette, pinned)", () => {
  const expected: Record<string, string> = {
    sand: "#efe5d5",
    sand2: "#e4d7c2",
    paper: "#fffbf4",
    line: "#dfd1ba",
    ink: "#1e1813",
    ink2: "#5b5045",
    ink3: "#665c52",
    espresso: "#2a1f18",
    espresso2: "#3b2d23",
    cream: "#f7efe2",
    brand: "#d9673b",
    brandDeep: "#b64f28",
    brandPressed: "#9c4322",
    brandTint: "#f9dece",
    brandOnTint: "#a74925",
    green: "#2c744b",
    greenBg: "#dfeee3",
    amber: "#925b0a",
    amberBg: "#f6e6c8",
    rose: "#9d4b51",
    roseBg: "#f7dcdc",
    danger: "#882020",
    dangerBg: "#f9d9d9",
    ai: "#7b4cb5",
    aiBg: "#eadff7",
    white: "#ffffff",
  };

  it.each(Object.entries(expected))("colors.%s is %s", (key, hex) => {
    expect(colors[key as keyof typeof colors]).toBe(hex);
  });

  it("has no keys beyond the pinned set (catches silent additions)", () => {
    expect(Object.keys(colors).sort()).toEqual(Object.keys(expected).sort());
  });
});

describe("radius", () => {
  it("matches prototype :root --r-sm/--r-md/--r-lg", () => {
    expect(radius.sm).toBe(12);
    expect(radius.md).toBe(18);
    expect(radius.lg).toBe(24);
  });

  it("pill radius is the tokens.md §1 recommended --r-pill", () => {
    expect(radius.pill).toBe(9999);
  });
});

describe("spacing", () => {
  it("is a plain ascending 4px-step scale", () => {
    const values = Object.values(spacing);
    for (let i = 1; i < values.length; i += 1) {
      expect(values[i]).toBeGreaterThan(values[i - 1] as number);
      expect((values[i] as number) % 4).toBe(0);
    }
  });
});

// --- WCAG 2.x contrast, reproduced verbatim from docs/design/tokens.md §2 ---

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function relLum([r, g, b]: [number, number, number]): number {
  const f = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const [R, G, B] = [f(r), f(g), f(b)];
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

function contrast(h1: string, h2: string): number {
  const L1 = relLum(hexToRgb(h1));
  const L2 = relLum(hexToRgb(h2));
  const l = Math.max(L1, L2);
  const d = Math.min(L1, L2);
  return (l + 0.05) / (d + 0.05);
}

/**
 * The seven D-021 fixes (DECISIONS.md D-021 / tokens.md §2 "FAILs and proposed
 * fixes"), each recomputed against its paired background at the category
 * threshold tokens.md uses (body 4.5:1, alert/allergen-text 7:1).
 */
describe("D-021 contrast fixes (seven pairs, recomputed)", () => {
  const cases: Array<{ name: string; fg: string; bg: string; threshold: number }> = [
    { name: "ink-3 on sand", fg: colors.ink3, bg: colors.sand, threshold: 4.5 },
    { name: "amber on amber-bg", fg: colors.amber, bg: colors.amberBg, threshold: 4.5 },
    { name: "green on green-bg", fg: colors.green, bg: colors.greenBg, threshold: 4.5 },
    { name: "rose on rose-bg", fg: colors.rose, bg: colors.roseBg, threshold: 4.5 },
    {
      name: "danger on danger-bg (allergen alert text, 7:1)",
      fg: colors.danger,
      bg: colors.dangerBg,
      threshold: 7,
    },
    {
      name: "brand-on-tint on brand-tint",
      fg: colors.brandOnTint,
      bg: colors.brandTint,
      threshold: 4.5,
    },
    {
      name: "white on brand-deep (primary CTA fill, D-021 row 24 reroute)",
      fg: colors.white,
      bg: colors.brandDeep,
      threshold: 4.5,
    },
  ];

  it.each(cases)("$name clears $threshold:1", ({ fg, bg, threshold }) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(threshold);
  });
});
