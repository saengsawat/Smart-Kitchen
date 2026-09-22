# apps/

Deployable applications. Populated starting ticket M0-T1 ([BACKLOG.md](../BACKLOG.md)):

- `api/` — modular monolith backend ([ADR-002](../docs/adr/ADR-002-backend-runtime.md))
- `mobile/`: Expo/React Native client ([ADR-001](../docs/adr/ADR-001-client-platform.md)). Scaffold, design
  tokens, tab shell and fixture `ApiClient` landed M3-T1; see [apps/mobile/README.md](mobile/README.md) for how
  to run it, including on a phone over the same Wi-Fi (Expo Go, no tunnel, no account).
