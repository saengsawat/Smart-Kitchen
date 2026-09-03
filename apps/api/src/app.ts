import Fastify, { type FastifyInstance } from "fastify";

/**
 * Placeholder app shell proving the chosen framework (ADR-002: Fastify) boots
 * and can be exercised by tests via `.inject()`, with no port bound.
 * Route/plugin structure for real modules (identity, household, inventory,
 * …) arrives with the tickets that own them (ARCHITECTURE.md §2).
 */
export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });

  app.get("/healthz", () => ({ status: "ok" }));

  return app;
}
