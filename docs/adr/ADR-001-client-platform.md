# ADR-001: Client platform

**Status:** PROPOSED · Owner: product owner + eng · Target decision point: before M3 (first client work)

## Context
Mobile-first product (brief §1). MVP needs: camera barcode scanning, responsive CRUD UI, two-device household sync; fast-follow needs receipt photo capture; later, push notifications. Small team, one codebase strongly preferred.

## Options considered

**A. Expo / React Native** — *Pros:* single TS codebase shared with backend types; mature camera/barcode modules; OTA updates; native performance where it matters. *Cons:* native-module upgrade churn; larger app than PWA; some Expo lock-in (mitigated: standard RN underneath).

**B. Mobile web / PWA** — *Pros:* zero install friction, one deploy, cheapest. *Cons:* camera/barcode APIs uneven across browsers, notably constrained on iOS Safari; push support on iOS limited; "photograph receipt/shelf" UX worse. The camera is the product's front door — this is the option's core weakness.

**C. Native Swift + Kotlin** — *Pros:* best platform integration (matters in Phase 3 smart-home era). *Cons:* two codebases, roughly double client cost; unjustifiable for a small team pre-PMF.

**D. Flutter** — *Pros:* strong cross-platform. *Cons:* Dart splits the stack from a TS backend/contracts package; team leverage lost.

## Recommendation
**A (Expo/React Native).** Camera-centric UX rules out B for MVP; team size rules out C; stack coherence favors A over D.

## Consequences
TypeScript everywhere; `packages/contracts` shared types become the client/server seam; keep client thin (server owns domain logic) so a future platform change is a UI rewrite, not a product rewrite.

## Open questions
- Expo managed vs bare workflow (decide at M3 with concrete module needs).
- Barcode scanning library choice (spike in M3).
