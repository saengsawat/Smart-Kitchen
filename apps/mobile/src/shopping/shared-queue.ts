/**
 * The one `ShoppingCheckOffQueue` the running app shares (review round 1,
 * F1 blocker fix).
 *
 * `app/shopping.tsx` previously held its queue in `useRef`, which unmounts
 * with the screen (`app/_layout.tsx`'s own doc comment: "a screen-local
 * `useState` unmounts with the screen" — the same reason `Toast.tsx` grew a
 * provider in M3-T4a). A queued check-off made offline, followed by a route
 * change away from Shopping and back before reconnecting, silently dropped
 * the queue and its pending entries: "never lost silently" (BACKLOG.md
 * M3-T5 invariant) requires the queue to outlive the screen component, not
 * just the render.
 *
 * A module-level singleton, the same pattern `src/api/client.ts`'s
 * `apiClient` already uses, rather than a React context: the queue itself
 * needs no provider tree or render output (unlike `ToastProvider`, which
 * exists specifically to render the toast banner outside `<Slot />`), so a
 * plain shared instance is the smaller, sufficient fix.
 */

import { ShoppingCheckOffQueue } from "./queue";

export const sharedShoppingQueue = new ShoppingCheckOffQueue();
