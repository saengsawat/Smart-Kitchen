import { describe, expect, it } from "vitest";
import { colors, fontFamily, radius, spacing, typeScale } from "./tokens";

/**
 * Pins every colour verbatim against prototype v6's `:root` block and
 * stylesheet literals (docs/design/mockups/smart-kitchen-prototype.html) and
 * docs/design/tokens.md sections 1a and 1b, so a drift in either place is
 * caught here. Safety and semantic hexes (green, amber, rose, danger, ai and
 * their tints) are the D-021 values, unchanged in v6.
 */
describe("colors (prototype v6, pinned)", () => {
  const expected: Record<string, string> = {
    paper: "#fbfaf6",
    tile: "#f1eee6",
    ink: "#0f0f0f",
    ink2: "#5f5d58",
    ink3: "#6f6c66",
    hair: "#dcd8cf",
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
    aiInk: "#5a4a70",
    white: "#ffffff",
    onInkMuted: "rgba(255,255,255,.78)",
    inkHover: "#2b2b2b",
    rowHover: "#f4f2ec",
    invHover: "#e4e1d9",
    amberInk: "#5b4210",
    greenInk: "#1f4d33",
    greenHover: "#235f3d",
    aiHair: "#d7c6ee",
    aiTile: "#f5f0fb",
    focus: "#2442d6",
    cameraBg: "#121212",
    cameraBg2: "#2b2a27",
    cameraText: "#f3f1ec",
    cameraTextMuted: "#d9d6cf",
    cameraLine: "rgba(255,255,255,.3)",
    cameraLineStrong: "rgba(255,255,255,.6)",
    cameraHover: "rgba(255,255,255,.1)",
    scrim: "rgba(15,15,15,.45)",
  };

  it.each(Object.entries(expected))("colors.%s is %s", (key, hex) => {
    expect(colors[key as keyof typeof colors]).toBe(hex);
  });

  it("has no keys beyond the pinned set (catches silent additions)", () => {
    expect(Object.keys(colors).sort()).toEqual(Object.keys(expected).sort());
  });

  it("has no v5 brand, espresso, sand or cream token left (v6 has no brand accent)", () => {
    for (const gone of [
      "brand",
      "brandDeep",
      "brandPressed",
      "brandTint",
      "brandOnTint",
      "espresso",
      "espresso2",
      "cream",
      "sand",
      "sand2",
      "line",
    ]) {
      expect(colors).not.toHaveProperty(gone);
    }
  });
});

describe("radius (tokens.md section 3a)", () => {
  it("photos and tiles are square", () => {
    expect(radius.none).toBe(0);
  });

  it("panel, verdict, toast and sheet radii match the v6 stylesheet", () => {
    expect(radius.panel).toBe(14);
    expect(radius.verdict).toBe(10);
    expect(radius.verdictSm).toBe(8);
    expect(radius.toast).toBe(12);
    expect(radius.sheet).toBe(22);
  });

  it("pill radius is larger than any control height (CSS 999px)", () => {
    expect(radius.pill).toBe(9999);
  });

  it("drops the v5 card radii", () => {
    expect(radius).not.toHaveProperty("sm");
    expect(radius).not.toHaveProperty("md");
    expect(radius).not.toHaveProperty("lg");
  });
});

describe("spacing (tokens.md section 3b)", () => {
  it("is strictly ascending", () => {
    const values = Object.values(spacing);
    for (let i = 1; i < values.length; i += 1) {
      expect(values[i]).toBeGreaterThan(values[i - 1] as number);
    }
  });

  it("keeps the 4px-step scale and adds the four v6 steps", () => {
    expect([spacing.xs, spacing.sm, spacing.md, spacing.lg, spacing.xl, spacing.xxl]).toEqual([
      4, 8, 12, 16, 24, 32,
    ]);
    expect(spacing.snug).toBe(10);
    expect(spacing.cozy).toBe(14);
    expect(spacing.gutter).toBe(20);
    expect(spacing.section).toBe(30);
  });
});

describe("fonts and type scale (DESIGN.md section 3)", () => {
  it("display is Bodoni Moda at 500, body is Schibsted Grotesk", () => {
    expect(fontFamily.display).toBe("Bodoni Moda");
    expect(fontFamily.body).toBe("Schibsted Grotesk");
    expect(fontFamily.bodyFallback).toBe("system-ui, sans-serif");
    for (const key of [
      "title",
      "h1",
      "statValue",
      "product",
      "empty",
      "sheetTitle",
      "section",
      "group",
      "qtyBig",
      "stepper",
    ] as const) {
      expect(typeScale[key].fontFamily).toBe("Bodoni Moda");
      expect(typeScale[key].fontWeight).toBe("500");
    }
  });

  it("pins the display sizes", () => {
    expect(typeScale.title.fontSize).toBe(44);
    expect(typeScale.h1.fontSize).toBe(40);
    expect(typeScale.statValue.fontSize).toBe(36);
    expect(typeScale.product.fontSize).toBe(30);
    expect(typeScale.empty.fontSize).toBe(28);
    expect(typeScale.sheetTitle.fontSize).toBe(26);
    expect(typeScale.section.fontSize).toBe(25);
    expect(typeScale.group.fontSize).toBe(22);
    expect(typeScale.qtyBig.fontSize).toBe(46);
    expect(typeScale.stepper.fontSize).toBe(26);
  });

  it("pins the UI sizes and weights", () => {
    expect(typeScale.rowTitle).toMatchObject({ fontSize: 15.5, fontWeight: "700" });
    expect(typeScale.body).toMatchObject({ fontSize: 15, fontWeight: "400" });
    expect(typeScale.button).toMatchObject({ fontSize: 14, fontWeight: "700" });
    expect(typeScale.label).toMatchObject({ fontSize: 13.5, fontWeight: "600" });
    expect(typeScale.caption).toMatchObject({ fontSize: 12.5, fontWeight: "400" });
    expect(typeScale.chip).toMatchObject({ fontSize: 12, fontWeight: "700" });
  });

  it("has no size below 12 (v6 floor)", () => {
    for (const step of Object.values(typeScale)) {
      expect(step.fontSize).toBeGreaterThanOrEqual(12);
    }
  });
});

// --- WCAG 2.x contrast, reproduced verbatim from docs/design/tokens.md section 4 ---

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
 * The text pairs the v6 app renders, each recomputed against its paired
 * background at the category threshold tokens.md section 4 uses (body 4.5:1,
 * alert/allergen-text 7:1, large 3:1, non-text 3:1). Row numbers are the
 * tokens.md section 4 rows. The narrow passes (rows 8, 24, 33, 34) must not
 * be lightened.
 */
describe("v6 contrast pairs (tokens.md section 4, recomputed)", () => {
  const cases: Array<{ name: string; fg: string; bg: string; threshold: number }> = [
    { name: "row 1 ink on paper", fg: colors.ink, bg: colors.paper, threshold: 4.5 },
    { name: "row 2 ink on tile", fg: colors.ink, bg: colors.tile, threshold: 4.5 },
    { name: "row 3 ink on ai-bg", fg: colors.ink, bg: colors.aiBg, threshold: 4.5 },
    { name: "row 5 ink2 on paper", fg: colors.ink2, bg: colors.paper, threshold: 4.5 },
    { name: "row 6 ink2 on tile", fg: colors.ink2, bg: colors.tile, threshold: 4.5 },
    { name: "row 7 ink3 on paper", fg: colors.ink3, bg: colors.paper, threshold: 4.5 },
    { name: "row 8 ink3 on tile (narrow)", fg: colors.ink3, bg: colors.tile, threshold: 4.5 },
    { name: "row 12 white on ink", fg: colors.white, bg: colors.ink, threshold: 4.5 },
    { name: "row 14 white on ink hover", fg: colors.white, bg: colors.inkHover, threshold: 4.5 },
    { name: "row 16 ink on row hover", fg: colors.ink, bg: colors.rowHover, threshold: 4.5 },
    {
      name: "row 20 danger on danger-bg (allergen alert text, 7:1)",
      fg: colors.danger,
      bg: colors.dangerBg,
      threshold: 7,
    },
    {
      name: "row 21 danger on paper (allergen alert text, 7:1)",
      fg: colors.danger,
      bg: colors.paper,
      threshold: 7,
    },
    {
      name: "row 24 amber on amber-bg (narrow)",
      fg: colors.amber,
      bg: colors.amberBg,
      threshold: 4.5,
    },
    {
      name: "row 25 amber ink on amber-bg",
      fg: colors.amberInk,
      bg: colors.amberBg,
      threshold: 4.5,
    },
    { name: "row 26 amber on paper", fg: colors.amber, bg: colors.paper, threshold: 4.5 },
    { name: "row 27 green on green-bg", fg: colors.green, bg: colors.greenBg, threshold: 4.5 },
    { name: "row 28 green on paper", fg: colors.green, bg: colors.paper, threshold: 4.5 },
    {
      name: "row 30 green ink on green-bg",
      fg: colors.greenInk,
      bg: colors.greenBg,
      threshold: 4.5,
    },
    {
      name: "row 31 white on green (the one green Add)",
      fg: colors.white,
      bg: colors.green,
      threshold: 4.5,
    },
    {
      name: "row 32 white on green hover",
      fg: colors.white,
      bg: colors.greenHover,
      threshold: 4.5,
    },
    { name: "row 33 rose on rose-bg (narrow)", fg: colors.rose, bg: colors.roseBg, threshold: 4.5 },
    { name: "row 34 ai on ai-bg (narrow)", fg: colors.ai, bg: colors.aiBg, threshold: 4.5 },
    { name: "row 35 ai ink on ai-bg", fg: colors.aiInk, bg: colors.aiBg, threshold: 4.5 },
    {
      name: "row 37 camera text on camera bg",
      fg: colors.cameraText,
      bg: colors.cameraBg,
      threshold: 4.5,
    },
    {
      name: "row 38 camera text on camera gradient top",
      fg: colors.cameraText,
      bg: colors.cameraBg2,
      threshold: 4.5,
    },
    {
      name: "row 39 camera muted on camera bg",
      fg: colors.cameraTextMuted,
      bg: colors.cameraBg,
      threshold: 4.5,
    },
    {
      name: "row 41 ink on inverted camera button",
      fg: colors.ink,
      bg: colors.cameraText,
      threshold: 4.5,
    },
    {
      name: "row 43 focus ring on paper (non-text)",
      fg: colors.focus,
      bg: colors.paper,
      threshold: 3,
    },
    {
      name: "row 44 focus ring on tile (non-text)",
      fg: colors.focus,
      bg: colors.tile,
      threshold: 3,
    },
    {
      name: "row 45 camera ring on camera bg (non-text)",
      fg: colors.cameraText,
      bg: colors.cameraBg,
      threshold: 3,
    },
    {
      name: "row 47 ink2 border on paper (non-text)",
      fg: colors.ink2,
      bg: colors.paper,
      threshold: 3,
    },
    {
      name: "row 48 ink border on paper (non-text)",
      fg: colors.ink,
      bg: colors.paper,
      threshold: 3,
    },
    {
      name: "selected allergen chip: danger on danger-bg (D-033 amendment, 7:1)",
      fg: colors.danger,
      bg: colors.dangerBg,
      threshold: 7,
    },
    {
      name: "selected severity button: white on danger (D-033 amendment)",
      fg: colors.white,
      bg: colors.danger,
      threshold: 4.5,
    },
  ];

  it.each(cases)("$name clears $threshold:1", ({ fg, bg, threshold }) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(threshold);
  });

  it("hair is a divider colour only: it does not clear 3:1 on paper (tokens.md row 46)", () => {
    expect(contrast(colors.hair, colors.paper)).toBeLessThan(3);
  });
});

/**
 * M3-T2 review (reviewer opinion): the S2 "No known allergies for {member}"
 * declaration's confirmed state uses `colors.green` text on `colors.greenBg`.
 * Numerically identical to the generic green case above, restated here so this
 * specific, newly added UI usage has its own named, traceable assertion.
 */
describe("M3-T2 S2 'none' declaration contrast (green on green-bg)", () => {
  it("clears 4.5:1 body-text threshold", () => {
    expect(contrast(colors.green, colors.greenBg)).toBeGreaterThanOrEqual(4.5);
  });
});
