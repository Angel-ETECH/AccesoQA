import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import http from "node:http";
import { chromium } from "playwright";
import { CreateFlowSchema, type AuditRun } from "@accesoqa/shared";
import { openDatabase } from "../db/database.js";
import { Repository } from "../db/repository.js";
import { compare, report, htmlReport, occurrences } from "./history.js";
import { scanPage, type ScanResult } from "./scanner.js";
import { buildServer } from "../server.js";
function setup() {
  const db = openDatabase(":memory:"),
    repo = new Repository(db);
  const project = repo.createProject({
    name: "Historial",
    baseUrl: "http://127.0.0.1/",
  });
  const flow = repo.saveFlow(
    project.id,
    CreateFlowSchema.parse({
      name: "Registro",
      testDataOnly: true,
      steps: [
        {
          action: "navigate",
          path: "/",
          label: "Pantalla",
          checkpoint: true,
          timeoutMs: 15000,
        },
      ],
    }),
  );
  return { db, repo, project, flow };
}
function result(rules = ["image-alt"]): ScanResult {
  return {
    url: "http://127.0.0.1/",
    title: "Página",
    engineVersion: "4.14.0",
    manualReviewCount: 0,
    findings: rules.map((ruleId) => ({
      ruleId,
      description: "Descripción",
      impact: "serious",
      help: "Ayuda",
      helpUrl: "https://example.test/regla",
      nodes: [
        {
          selector: JSON.stringify(["#elemento"]),
          html: '<img id="elemento">',
          failureSummary: "Falta texto",
        },
      ],
    })),
  };
}
function save(env: ReturnType<typeof setup>, value: ScanResult) {
  const run = env.repo.createFlowRun(env.flow, env.project.baseUrl);
  env.repo.running(run.id);
  env.repo.startStep(run.id, 1);
  env.repo.completeStep(run.id, 1, value);
  env.repo.finishRun(run.id, value.manualReviewCount, value.engineVersion);
  return env.repo.run(run.id)!;
}
describe("historial y comparación conservadora", () => {
  it("clasifica nuevas, persistentes y potencialmente corregidas por elemento", () => {
    const e = setup();
    try {
      const a = save(e, result()),
        b = save(e, result(["image-alt", "button-name"])),
        c = save(e, result([]));
      expect(compare(a, b).counts).toEqual({
        new: 1,
        persistent: 1,
        potentiallyFixed: 0,
        notCompared: 0,
      });
      expect(compare(b, c).counts.potentiallyFixed).toBe(2);
      expect(compare(b, c).coverage).toBe("complete");
    } finally {
      e.db.close();
    }
  });
  it("deduplica en SQLite y mantiene la identidad con cambios de HTML e impacto", () => {
    const e = setup();
    try {
      const value = result();
      value.findings.push(structuredClone(value.findings[0]!));
      value.findings[0]!.nodes.push(
        structuredClone(value.findings[0]!.nodes[0]!),
      );
      const a = save(e, value);
      expect(a.findings).toHaveLength(1);
      expect(a.findings[0]!.nodes).toHaveLength(1);
      const changed = result();
      changed.findings[0]!.nodes[0]!.html = '<img id="elemento" class="nuevo">';
      changed.findings[0]!.impact = "critical";
      const b = save(e, changed);
      expect(occurrences(a)[0]!.stableId).toBe(occurrences(b)[0]!.stableId);
      expect(compare(a, b).counts.persistent).toBe(1);
      expect(report(b).summary.byImpact.critical).toBe(1);
    } finally {
      e.db.close();
    }
  });
  it.each([
    "failed",
    "queued",
    "running",
    "missing",
    "manual",
    "engine",
    "config",
    "legacy",
    "screen",
    "path",
  ])("no afirma correcciones con %s", (kind) => {
    const e = setup();
    try {
      const a = save(e, result()),
        b = save(e, result([]));
      if (kind === "failed" || kind === "queued" || kind === "running")
        b.status = kind;
      if (kind === "missing") b.checkpoints = [];
      if (kind === "manual") b.checkpoints[0]!.manualReviewCount = 1;
      if (kind === "engine") b.checkpoints[0]!.engineVersion = "otra";
      if (kind === "config") b.configKey = "otra";
      if (kind === "legacy") b.configKey = null;
      if (kind === "screen") b.checkpoints[0]!.url += "?otro=1";
      if (kind === "path" && b.steps[0]!.definition.action === "navigate")
        b.steps[0]!.definition.path = "/otra";
      const comparison = compare(a, b);
      expect(comparison.counts.potentiallyFixed).toBe(0);
      expect(comparison.coverage).toBe("unavailable");
      expect(comparison.reasons.length).toBeGreaterThan(0);
    } finally {
      e.db.close();
    }
  });
  it("rechaza distinto flujo, misma ejecución y orden inverso", () => {
    const e = setup();
    try {
      const a = save(e, result()),
        b = save(e, result());
      expect(() => compare(a, a)).toThrow();
      expect(() => compare(a, { ...b, flowId: randomUUID() })).toThrow();
      expect(() => compare({ ...a, createdAt: "2099-01-01" }, b)).toThrow();
    } finally {
      e.db.close();
    }
  });
  it("conserva historial, metadatos, pasos y exporta HTML inerte", async () => {
    const e = setup();
    try {
      const value = result();
      value.title = "<script>window.pwned=1</script>";
      value.findings[0]!.nodes[0]!.html =
        '<img src="https://evil.test/a" onerror="window.pwned=1"><script>window.pwned=1</script>';
      const a = save(e, value);
      const failed = e.repo.createFlowRun(e.flow, e.project.baseUrl);
      e.repo.fail(failed.id, "Fallo de prueba");
      expect(e.repo.history(e.project.id, 1, 0).total).toBe(2);
      expect(e.repo.history(e.project.id, 1, 1).items[0]!.id).toBe(a.id);
      const json = report(a);
      expect(json.run).toEqual(a);
      expect(json.occurrences[0]!.html).toBe(value.findings[0]!.nodes[0]!.html);
      expect(report(e.repo.run(failed.id)!).run.findingsCount).toBeNull();
      const html = htmlReport(a);
      expect(html).toContain("&lt;script&gt;");
      expect(html).not.toContain("<script>");
      const browser = await chromium.launch();
      try {
        const page = await browser.newPage();
        const requests: string[] = [];
        page.on("request", (r) => requests.push(r.url()));
        await page.setContent(html);
        expect(await page.evaluate(() => "pwned" in window)).toBe(false);
        expect(await page.locator("img,script").count()).toBe(0);
        expect(requests).toEqual([]);
      } finally {
        await browser.close();
      }
    } finally {
      e.db.close();
    }
  });
  it("API valida paginación, permite consultar y exportar estados fallidos", async () => {
    const app = buildServer({
      databasePath: ":memory:",
      logger: false,
      scanner: async () => {
        throw new Error("Página inaccesible");
      },
    });
    try {
      const project = (
        await app.inject({
          method: "POST",
          url: "/api/projects",
          payload: { name: "API historial", baseUrl: "http://127.0.0.1:1/" },
        })
      ).json() as { id: string };
      const run = (
        await app.inject({
          method: "POST",
          url: `/api/projects/${project.id}/audits`,
        })
      ).json() as { id: string };
      await expect
        .poll(
          async () =>
            ((await app.inject(`/api/audits/${run.id}`)).json() as AuditRun)
              .status,
        )
        .toBe("failed");
      expect(
        (await app.inject(`/api/projects/${project.id}/audits?limit=101`))
          .statusCode,
      ).toBe(400);
      expect(
        (await app.inject(`/api/projects/${project.id}/audits?offset=-1`))
          .statusCode,
      ).toBe(400);
      const history = (
        await app.inject(`/api/projects/${project.id}/audits`)
      ).json() as { total: number };
      expect(history.total).toBe(1);
      const json = await app.inject(`/api/audits/${run.id}/export.json`);
      expect(json.statusCode).toBe(200);
      expect(json.json().run.status).toBe("failed");
      expect(json.json().run.findingsCount).toBeNull();
      const html = await app.inject(`/api/audits/${run.id}/export.html`);
      expect(html.headers["content-disposition"]).toContain("attachment");
      expect(html.headers["content-security-policy"]).toContain("sandbox");
      expect(html.body).toContain("Resultado parcial");
      expect(
        (await app.inject(`/api/audits/${randomUUID()}/export.json`))
          .statusCode,
      ).toBe(404);
    } finally {
      await app.close();
    }
  });
  it("compara revisiones reales de axe sobre una misma URL", async () => {
    const e = setup();
    let revision = 0;
    const server = http.createServer((_req, res) => {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(
        `<!doctype html><html lang="es"><head><title>Registro</title></head><body><main><h1>Registro</h1>${revision < 2 ? '<img id="foto" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7">' : ""}${revision === 1 ? '<button id="crear"></button>' : ""}</main></body></html>`,
      );
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Puerto ausente");
    try {
      const url = `http://127.0.0.1:${address.port}/`;
      const a = save(e, await scanPage(url));
      revision = 1;
      const b = save(e, await scanPage(url));
      revision = 2;
      const c = save(e, await scanPage(url));
      expect(a.findings.some((f) => f.ruleId === "image-alt")).toBe(true);
      expect(compare(a, b).counts.persistent).toBeGreaterThan(0);
      expect(
        compare(a, b).changes.some(
          (c) =>
            c.classification === "new" && c.after?.ruleId === "button-name",
        ),
      ).toBe(true);
      expect(compare(b, c).counts.potentiallyFixed).toBeGreaterThan(0);
      expect(c.findings).toHaveLength(0);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      e.db.close();
    }
  }, 30000);
});
