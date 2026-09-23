/**
 * Tab shell configuration (M3-T1).
 *
 * Plain data, no React/React Native import, so it can be unit-tested without a
 * component-rendering test harness (M3-T1 escalations: @testing-library/react-native
 * was not adopted; this file plus tabs.test.ts is the "pure test of the route
 * config" the ticket calls for instead).
 *
 * Order and labels match prototype v4's `.nav` bar exactly (Home, Inventory,
 * [centre scan button], Menu, Shopping). See
 * docs/design/mockups/smart-kitchen-prototype.html `.nav` markup, and D-020 for
 * the Menu slot (replacing "Recipes").
 */

export type TabIconKind = "home" | "inventory" | "calendar" | "cart";

export interface TabDefinition {
  /** Stable identifier, also used as the expo-router route segment. */
  readonly key: string;
  readonly label: string;
  /** expo-router path, relative to the app root. */
  readonly route: string;
  readonly icon: TabIconKind;
  /**
   * The placeholder screen's second line (P11: plain sentence, no em dash).
   * Every tab but Menu reads "Coming in <ticket>." per the ticket's Objective
   * (c). Menu has no M3-Tn ticket yet (D-023: held until Dean's list is
   * triaged and D-020 is ratified), so it states that instead.
   */
  readonly placeholder: string;
}

/**
 * The four bottom-bar slots, left to right, either side of the centre scan
 * button. Home's `placeholder` no longer reads "Coming in M3-T2.": M3-T2 is
 * the ticket that builds Home's first-run state (`app/index.tsx`,
 * `src/screens/HomeScreen.tsx`), so that string went stale the moment this
 * ticket landed (CLAUDE.md rule 15). The full S3 dashboard (states beyond
 * first-run empty) stays held pending OQ-D9/Dean's list (D-023), matching the
 * "held" phrasing already used for Menu below.
 */
export const TAB_ORDER: readonly TabDefinition[] = [
  {
    key: "home",
    label: "Home",
    route: "/",
    icon: "home",
    placeholder: "Full dashboard held pending Dean's review (OQ-D9).",
  },
  {
    key: "inventory",
    label: "Inventory",
    route: "/inventory",
    icon: "inventory",
    placeholder: "Coming in M3-T3.",
  },
  {
    key: "menu",
    label: "Menu",
    route: "/menu",
    icon: "calendar",
    placeholder: "Held until D-020 is ratified.",
  },
  {
    key: "shopping",
    label: "Shopping",
    route: "/shopping",
    icon: "cart",
    placeholder: "Coming in M3-T5.",
  },
] as const;

/**
 * The centre floating scan button (prototype `.fab`); not part of
 * TAB_ORDER's flex row. `placeholder` (M3-T1: "Coming in M3-T4.") is
 * removed as of M3-T4b: `app/add.tsx` and its `app/add/*` routes are the
 * real S6-S9 screens now, not `PlaceholderScreen` (CLAUDE.md rule 15 — a
 * stale "coming in" string the moment the ticket that builds it lands).
 */
export const CENTER_ACTION = {
  key: "add",
  label: "Add",
  route: "/add",
} as const;

export function isActiveRoute(currentPathname: string, tabRoute: string): boolean {
  if (tabRoute === "/") {
    return currentPathname === "/" || currentPathname === "";
  }
  return currentPathname === tabRoute || currentPathname.startsWith(`${tabRoute}/`);
}
