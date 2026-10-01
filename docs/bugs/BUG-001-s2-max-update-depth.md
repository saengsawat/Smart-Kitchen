# BUG-001: S2 allergies Continue crashes with "Maximum update depth exceeded" (Android and web)

**Reported:** 2026-09-30 by Andy (PO), on his phone.
**Status:** OPEN, regression, reproduces in both demo and real mode (Andy's
phone). Not reproduced by an agent yet.
**Code at:** main `74371f1` (just after the M3-T6 merge).

> **To the lead:** this file isn't committed yet. Please commit it right after
> the bug is fixed, together with the fix. The uncommitted `cd D:\06_Smart-Kitchen`
> lines in `apps/mobile/README.md` (Steps 3 and 5) can go in the same commit.

## Setup

- Android phone, Expo Go, same Wi-Fi as the PC.
- Real mode: `EXPO_PUBLIC_API_URL` set to the PC's LAN address on port 3000;
  API started with `SK_IDENTITY=fixture`, `NODE_ENV=development`, against the
  seeded practice database (port 55432).
- Signed in as the default fixture identity (Dean, Chen household).

## Steps

1. Launch the app. It opens on S2 (allergies), which is expected over the API.
2. Select one or more allergen chips. No error.
3. Select one or more preference chips. No error.
4. Tap **Continue**. The app crashes with the error below.

Confirmed by Andy 2026-09-30: the crash fires on Continue, not on the chip
taps. Selecting chips works fine.

**Demo mode crashes too** (confirmed by Andy 2026-09-30): app started with
`EXPO_PUBLIC_API_URL` removed and `--clear`, S1 Create household, S2
allergens plus preferences, Continue. Same error, same stack. So this is not
specific to the HTTP client.

**Regression.** The same demo-mode flow worked for Andy on 2026-09-29. The exact
commit he ran then isn't recorded, but these mobile commits landed after the
morning of 2026-09-29:

| Commit | When | Ticket | Touches the S2 to Home path? |
| --- | --- | --- | --- |
| `74371f1` | 09-30 08:18 | M3-T6 profile | **Yes**: `allergies.tsx` (extracted `MemberAllergySection`), `account.tsx`, `HomeScreen.tsx` (new header and `/profile` entry), `client.ts` (+189), new `app/profile.tsx` route |
| `01fca8a` | 09-30 01:13 | M7-T1 shopping | `client.ts` (+195) only |
| `7bc7086` | 09-29 17:38 | M3-T4e scan | scan sheet and `client.ts` |
| `8d1217b` | 09-29 16:13 | M3-T4d client wiring | `_layout.tsx` gate (fail-closed read, pending-read hold), S1, S9, `client.ts` |
| `4af01c9` | 09-29 15:29 | M2-T4a lookup | product lookup |
| `dba4a7a` | 09-29 02:30 | M3-T5 shopping | S11 |

Fastest way to pin it: check out `01fca8a` (just before M3-T6), run the demo
flow; if it passes, M3-T6 is the cause. If it fails, try `8d1217b^` (just
before M3-T4d). `git bisect` with the demo flow as the check works too.

## Result

Red-screen render error:

```
Maximum update depth exceeded. This can happen when a component repeatedly
calls setState inside componentWillUpdate or componentDidUpdate. React limits
the number of nested updates to prevent infinite loops.

Source: react-native/Libraries/Renderer/implementations/ReactFabric-dev.js (5107:15)
```

Top of the call stack:

```
getRootForUpdatedFiber          ReactFabric-dev.js:5107
enqueueConcurrentRenderForLane  ReactFabric-dev.js:5071
forceStoreRerender              ReactFabric-dev.js:6217
subscribe$argument_0            ReactFabric-dev.js:6203
listeners.forEach               expo-router/build/react-navigation/core/useSyncState.js:80
batchUpdates                    expo-router/build/react-navigation/core/useSyncState.js:80
<anonymous>                     expo-router/build/react-navigation/core/useSyncState.js:102
latestCallback                  expo-router/build/utils/useLatestCallback.js:52
commitHookEffectListMount / commitHookLayoutEffects
... deep recursivelyTraverseLayoutEffects chain ...
flushLayoutEffects -> commitRoot -> performSyncWorkOnRoot
```

The Metro terminal showed the same message as a plain `ERROR` line, with no
other app log before it.

**Web reproduces it too** (Andy, 2026-09-30, Windows browser, demo mode; real
mode can't run on web, see BUG-002). Same loop, with `react-dom` in place of
`ReactFabric`, and the web overlay adds a component stack:

```
Component Stack
  at ContextNavigator  expo-router/build/ExpoRoot.js:135:566
  at ExpoRoot          expo-router/build/ExpoRoot.js:85:33
  at App               expo-router/build/qualified-entry.js:20:91
  at WithDevTools      expo/src/launch/withDevTools.web.tsx:11:9

Call Stack
  at getRootForUpdatedFiber          react-dom-client.development.js:4624
  at enqueueConcurrentRenderForLane  react-dom-client.development.js:4588
  at forceStoreRerender              react-dom-client.development.js:8261
  at subscribe$argument_0            react-dom-client.development.js:8247
  at listeners.forEach               expo-router/build/react-navigation/core/useSyncState.js:80
  at batchUpdates                    expo-router/build/react-navigation/core/useSyncState.js:80
  at <anonymous>                     expo-router/build/react-navigation/core/useSyncState.js:102
  at latestCallback                  expo-router/build/utils/useLatestCallback.js:52
  at commitHookEffectListMount / commitHookLayoutEffects
  ... deep recursivelyTraverseLayoutEffects chain ...
```

`ContextNavigator` is expo-router's root navigator, which supports the
reading below that the loop is in app-level navigation state, not in S2.
Good news for the fix: the bug reproduces in a desktop browser with no
phone, API or database, so a headless browser test can guard it.

## Analysis so far (INFERRED, not confirmed)

- The loop is inside expo-router's navigation state sync (`useSyncState`),
  fired from a layout effect. It is not a `setState` in S2's own component.
  That points at a navigation ping-pong rather than S2's local state.
- Likeliest place: the onboarding gate in `apps/mobile/app/_layout.tsx`. It
  switches between `<Redirect>`, `<Slot />` and `null` (the stale-read "hold"
  branch from M3-T4d review round 2) and re-reads `getOnboardingState()` on
  every pathname change. Suspected sequence: Continue calls
  `router.replace("/")`, the layout sees a stale read tagged
  `/onboarding/allergies`, holds by unmounting `<Slot />`, then remounts it;
  a redirect computed in that window could loop with the navigator's own
  state sync.
- ~~Second suspect: the HTTP household sync resetting restrictions.~~ Ruled
  out as the sole cause: demo mode (fixture client, no HTTP) crashes the same way.
- M3-T6, merged just before this report, touched the same flow (extracted
  `MemberAllergySection`, S1 routes an already-affiliated caller straight to
  Home, a new Home header pushing `/profile`, a new `app/profile.tsx` route,
  sign-out clears the inventory cache). Top suspect given the regression
  window. Note `8d1217b` (M3-T4d) also changed the `_layout.tsx` gate the same
  day; if Andy's working run on 09-29 predates it, that commit is in the
  window as well.

## Still unknown

- Which commit introduced it (see the regression table above).
- Whether iOS behaves the same (Android and web both crash).

## Suggested approach for the fix

1. Reproduce first, exactly as reported. Demo mode is enough (no API or
   database needed): S1 Create household, S2 allergens plus preferences,
   Continue. Then find the introducing commit.
2. Turn the repro into an automated test (S2 Continue lands on Home without a
   redirect loop, over both the fixture and HTTP clients) so it can't come back.
3. Fix the simplest root cause, then confirm on the phone.
4. If it can't be reproduced, say so before shipping a fix.

## Related

- [BUG-002](BUG-002-api-no-cors.md): real mode can't work in a browser (found
  during the attempted repro).
