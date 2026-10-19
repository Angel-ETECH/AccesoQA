import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "./server.js";

describe("GET /api/health", () => {
  const app = buildServer({ databasePath: ":memory:" });
  afterEach(async () => app.close());

  it("responde con el contrato de salud sin iniciar un listener", async () => {
    const response = await app.inject({ method: "GET", url: "/api/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "ok",
      service: "accesoqa-api",
      version: "0.1.0",
    });
  });
});
