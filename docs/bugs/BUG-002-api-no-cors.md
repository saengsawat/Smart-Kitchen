# BUG-002: API sends no CORS headers, so the web build can't use real mode

**Found:** 2026-09-30 while trying to reproduce [BUG-001](BUG-001-s2-max-update-depth.md).
**Status:** OPEN. Needs a product call: is web against the API meant to work?
**Code at:** main `74371f1`.

> **To the lead:** this file isn't committed yet. Please commit it right after
> the bug is fixed (or decided), together with the fix.

## What happens

The web build started with `EXPO_PUBLIC_API_URL=http://localhost:3000` shows
"Couldn't load your household." on launch. The same API works from the phone,
which isn't subject to CORS.

## Evidence

A plain GET with the fixture token works:

```
GET /v1/households/me   (Origin: http://localhost:8090)
-> 200 OK, no Access-Control-Allow-Origin header
```

The browser's preflight fails:

```
OPTIONS /v1/households/me
Origin: http://localhost:8090
Access-Control-Request-Method: GET
Access-Control-Request-Headers: authorization
-> 404 Not Found, no Access-Control-Allow-* headers
```

The `Authorization` header makes every app request a preflighted request, so
the browser blocks all of them.

## Impact

- Real mode works on phones only. Web works in demo mode only.
- `apps/mobile/README.md` currently implies real mode works on web too
  ("Then open it on your phone, or press `w` for web"). Fix the README or the
  API, whichever the decision lands on.

## Open question

Allowing browser origins on the API is a security decision (which origins,
dev only or also production). Needs an architect proposal, not a quick patch.
