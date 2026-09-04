import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";

describe("apps/api placeholder", () => {
  it("proves the test harness runs and Fastify responds (no port bound)", async () => {
    const app = buildApp();
    const response = await app.inject({ method: "GET", url: "/healthz" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });

    await app.close();
  });
});
