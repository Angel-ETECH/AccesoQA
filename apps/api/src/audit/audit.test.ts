import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type ViteDevServer } from "vite";
import {
  AuditRunSchema,
  normalizeLocalUrl,
  ProjectSchema,
  type AuditRun,
} from "@accesoqa/shared";
import { buildServer } from "../server.js";
import { scanPage } from "./scanner.js";
import { openDatabase } from "../db/database.js";
import { Repository } from "../db/repository.js";

describe("validación estricta de destinos", () => {
  it.each([
    "https://example.com",
    "http://192.168.1.1",
    "http://127.0.0.2",
    "http://127.1",
    "http://2130706433",
    "http://0x7f000001",
    "http://localhost.evil.test",
    "http://localhost./",
    "http://user:pass@localhost",
    "http://localhost@evil.test",
    "file:///C:/Windows",
    "javascript:alert(1)",
    "http://[::ffff:127.0.0.1]",
    "http://localhost:0",
    "http://localhost:65536",
    " http://localhost",
    "http://localhost\\@evil.test",
    "http://local\nhost",
    "http://localhost%2e/",
  ])("rechaza %s", (value) => {
    expect(() => normalizeLocalUrl(value)).toThrow();
  });
  it.each([
    "http://localhost:4312/?modo=problemas",
    "https://127.0.0.1:8443/",
    "http://[::1]:4312/",
  ])("acepta %s", (value) => {
    expect(normalizeLocalUrl(value)).toBe(value);
  });
});

describe("auditoría real con Chromium, API y SQLite", () => {
  let fixture: ViteDevServer;
  let fixtureUrl: string;
  let targetUrl: string;
  let temporaryDirectory: string;
  let dbPath: string;
  let app: ReturnType<typeof buildServer>;
  let forbiddenUrl: string;
  let forbiddenHits = 0;
  const forbiddenTarget = http.createServer((_request, response) => {
    forbiddenHits++;
    response.end("Este destino no debe recibir tráfico.");
  });
  const target = http.createServer((request, response) => {
    if (request.url === "/local") {
      response.writeHead(302, { location: `${fixtureUrl}/?modo=problemas` });
      response.end();
    } else if (request.url === "/chain") {
      response.writeHead(302, { location: "/away" });
      response.end();
    } else if (request.url === "/away") {
      response.writeHead(302, { location: forbiddenUrl });
      response.end();
    } else if (request.url === "/resource") {
      response.writeHead(200, { "Content-Type": "text/html" });
      response.end(
        '<!doctype html><html lang="es"><title>Recurso externo</title><main><h1>Prueba</h1><img src="http://example.invalid/tracker"></main></html>',
      );
    } else if (request.url === "/hang") {
      /* Intentionally never responds: verifies navigation timeout. */
    } else {
      response.writeHead(503);
      response.end("No disponible");
    }
  });

  beforeAll(async () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), "accesoqa-audit-"));
    dbPath = join(temporaryDirectory, "audit.sqlite");
    const reservation = http.createServer();
    await new Promise<void>((resolve) =>
      reservation.listen(0, "127.0.0.1", resolve),
    );
    const reservedAddress = reservation.address();
    if (!reservedAddress || typeof reservedAddress === "string")
      throw new Error("Puerto ausente");
    await new Promise<void>((resolve) => reservation.close(() => resolve()));
    fixture = await createServer({
      configFile: false,
      cacheDir: join(temporaryDirectory, "fixture-vite-cache"),
      root: fileURLToPath(new URL("../../../fixture", import.meta.url)),
      server: {
        host: "127.0.0.1",
        port: reservedAddress.port,
        strictPort: true,
        hmr: false,
      },
      logLevel: "error",
    });
    await fixture.listen();
    const address = fixture.httpServer!.address();
    if (!address || typeof address === "string")
      throw new Error("Fixture sin puerto");
    fixtureUrl = `http://127.0.0.1:${address.port}`;
    await new Promise<void>((resolve) =>
      target.listen(0, "127.0.0.1", resolve),
    );
    const targetAddress = target.address();
    if (!targetAddress || typeof targetAddress === "string")
      throw new Error("Servidor sin puerto");
    targetUrl = `http://127.0.0.1:${targetAddress.port}`;
    await new Promise<void>((resolve) =>
      forbiddenTarget.listen(0, "127.0.0.2", resolve),
    );
    const forbiddenAddress = forbiddenTarget.address();
    if (!forbiddenAddress || typeof forbiddenAddress === "string")
      throw new Error("Puerto ausente");
    forbiddenUrl = `http://127.0.0.2:${forbiddenAddress.port}/forbidden`;
    app = buildServer({ databasePath: dbPath, logger: false });
  }, 30000);
  afterAll(async () => {
    await app?.close();
    await fixture?.close();
    target.closeAllConnections();
    await new Promise<void>((resolve) => target.close(() => resolve()));
    forbiddenTarget.closeAllConnections();
    await new Promise<void>((resolve) =>
      forbiddenTarget.close(() => resolve()),
    );
    if (temporaryDirectory)
      rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  async function project(url: string) {
    const response = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { name: "Prueba de integración", baseUrl: url },
    });
    expect(response.statusCode).toBe(201);
    return ProjectSchema.parse(response.json());
  }
  async function finish(id: string): Promise<AuditRun> {
    const deadline = Date.now() + 55000;
    while (Date.now() < deadline) {
      const run = AuditRunSchema.parse(
        (await app.inject({ url: `/api/audits/${id}` })).json(),
      );
      if (run.status === "completed" || run.status === "failed") return run;
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    throw new Error("Auditoría sin finalizar");
  }

  it("marca como fallida una ejecución interrumpida al reiniciar la API", async () => {
    const path = join(temporaryDirectory, "interrupted.sqlite");
    const db = openDatabase(path);
    const repository = new Repository(db);
    const created = repository.createProject({
      name: "Interrumpida",
      baseUrl: fixtureUrl,
    });
    const run = repository.createRun(created.id, fixtureUrl);
    repository.running(run.id);
    db.close();
    const restarted = buildServer({ databasePath: path, logger: false });
    try {
      const recovered = AuditRunSchema.parse(
        (await restarted.inject({ url: `/api/audits/${run.id}` })).json(),
      );
      expect(recovered.status).toBe("failed");
      expect(recovered.findingsCount).toBeNull();
      expect(recovered.errorMessage).toMatch(/reinició/);
    } finally {
      await restarted.close();
    }
  });

  it("detecta defectos reales, conserva detalles, bloquea concurrencia y persiste tras reabrir SQLite", async () => {
    const created = await project(`${fixtureUrl}/?modo=problemas`);
    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${created.id}/audits`,
      payload: {},
    });
    expect(response.statusCode).toBe(202);
    const queued = AuditRunSchema.parse(response.json());
    expect(queued.status).toBe("queued");
    expect(queued.findingsCount).toBeNull();
    const duplicate = await app.inject({
      method: "POST",
      url: `/api/projects/${created.id}/audits`,
      payload: {},
    });
    expect(duplicate.statusCode).toBe(409);
    const run = await finish(queued.id);
    expect(run.status, run.errorMessage ?? "").toBe("completed");
    expect(run.findings.map((finding) => finding.ruleId)).toEqual(
      expect.arrayContaining(["image-alt", "label", "color-contrast"]),
    );
    expect(
      run.findings.find((finding) => finding.ruleId === "image-alt")?.nodes[0]
        ?.html,
    ).toContain("sample.svg");
    for (const finding of run.findings) {
      expect(finding.url).toBe(`${fixtureUrl}/?modo=problemas`);
      expect(finding.helpUrl).toMatch(/^https:\/\//);
      expect(finding.nodes[0]?.selector).toBeTruthy();
      expect(finding.createdAt).toBeTruthy();
    }
    await app.close();
    app = buildServer({ databasePath: dbPath, logger: false });
    expect(
      AuditRunSchema.parse(
        (
          await app.inject({ url: `/api/projects/${created.id}/audits/latest` })
        ).json(),
      ),
    ).toEqual(run);
  }, 60000);

  it("analiza la versión corregida con axe-core y desaparecen los defectos intencionales", async () => {
    const result = await scanPage(`${fixtureUrl}/?modo=corregido`);
    expect(result.findings.map((finding) => finding.ruleId)).not.toEqual(
      expect.arrayContaining(["image-alt"]),
    );
    expect(
      result.findings.filter((finding) =>
        ["image-alt", "label", "color-contrast"].includes(finding.ruleId),
      ),
    ).toEqual([]);
    expect(result.engineVersion).toBeTruthy();
  }, 60000);

  it("acepta una redirección local y registra la URL final", async () => {
    const result = await scanPage(`${targetUrl}/local`);
    expect(result.url).toBe(`${fixtureUrl}/?modo=problemas`);
    expect(result.findings.length).toBeGreaterThan(0);
  }, 60000);

  it.each(["/chain", "/resource"])(
    "bloquea el destino externo de %s sin producir un resultado limpio",
    async (path) => {
      const created = await project(`${targetUrl}${path}`);
      const queued = AuditRunSchema.parse(
        (
          await app.inject({
            method: "POST",
            url: `/api/projects/${created.id}/audits`,
            payload: {},
          })
        ).json(),
      );
      const run = await finish(queued.id);
      expect(run.status).toBe("failed");
      expect(run.errorMessage).toMatch(/bloque/i);
      expect(run.findingsCount).toBeNull();
      expect(run.findings).toEqual([]);
      expect(run.manualReviewCount).toBeNull();
      expect(forbiddenHits).toBe(0);
    },
    60000,
  );

  it("rechaza URLs públicas y orígenes ajenos antes de crear registros", async () => {
    const before = (await app.inject({ url: "/api/projects" })).json();
    for (const baseUrl of [
      "https://example.com",
      "http://192.168.1.1/",
      "http://127.1/",
    ]) {
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/projects",
            payload: { name: "No autorizado", baseUrl },
          })
        ).statusCode,
      ).toBe(400);
    }
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/projects",
          headers: { origin: "https://evil.invalid" },
          payload: { name: "No autorizado", baseUrl: fixtureUrl },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          url: "/api/projects",
          headers: { host: "evil.invalid" },
        })
      ).statusCode,
    ).toBe(403);
    expect((await app.inject({ url: "/api/projects" })).json()).toEqual(before);
  });

  it("guarda páginas inaccesibles como fallidas, con recuento nulo", async () => {
    const unused = http.createServer();
    await new Promise<void>((resolve) =>
      unused.listen(0, "127.0.0.1", resolve),
    );
    const address = unused.address();
    if (!address || typeof address === "string")
      throw new Error("Puerto ausente");
    const url = `http://127.0.0.1:${address.port}`;
    await new Promise<void>((resolve) => unused.close(() => resolve()));
    const created = await project(url);
    const queued = AuditRunSchema.parse(
      (
        await app.inject({
          method: "POST",
          url: `/api/projects/${created.id}/audits`,
          payload: {},
        })
      ).json(),
    );
    const run = await finish(queued.id);
    expect(run.status).toBe("failed");
    expect(run.errorMessage).toBeTruthy();
    expect(run.findingsCount).toBeNull();
    expect(run.url).toBeNull();
  }, 60000);

  it("termina una navegación que no responde dentro del timeout", async () => {
    await expect(scanPage(`${targetUrl}/hang`)).rejects.toThrow(
      /Timeout|tiempo/,
    );
  }, 60000);

  it("rechaza una respuesta HTTP de error como auditoría fallida", async () => {
    await expect(scanPage(`${targetUrl}/http-error`)).rejects.toThrow(
      /HTTP 503/,
    );
  }, 60000);
});
