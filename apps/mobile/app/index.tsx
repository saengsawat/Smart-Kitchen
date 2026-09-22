import { HomeScreen } from "../src/screens/HomeScreen";

/**
 * Root route ("/"). First-run routing (new user -> S1 -> S2, returning user
 * -> Home) is decided once, for every route, by `app/_layout.tsx` (M3-T2
 * review F2: the gate must not be re-derived per screen, or a deep link to a
 * route with no gate check of its own can bypass it). By the time this
 * component renders, `_layout.tsx` has already established the onboarding
 * route is "home" — this file only ever renders Home itself.
 */
export default function IndexRoute(): React.JSX.Element {
  return <HomeScreen />;
}
