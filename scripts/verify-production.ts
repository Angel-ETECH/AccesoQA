import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import http from "node:http";
import assert from "node:assert/strict";
import { preview, type PreviewServer } from "vite";
import { chromium, type Browser } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import {
  AuditRunSchema,
  FlowSchema,
  ProjectSchema,
  AuditReportSchema,
} from "@accesoqa/shared";
async function freePort() {
  const server = http.createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address();
  assert(address && typeof address !== "string");
  await new Promise<void>((r) => server.close(() => r()));
  return address.port;
}
const directory = mkdtempSync(join(tmpdir(), "accesoqa-production-"));
let web: PreviewServer | undefined,
  fixture: PreviewServer | undefined,
  browser: Browser | undefined;
const apiPort = await freePort(),
  webPort = await freePort(),
  fixturePort = await freePort();
const apiUrl = `http://127.0.0.1:${apiPort}`,
  webUrl = `http://127.0.0.1:${webPort}`,
  fixtureUrl = `http://127.0.0.1:${fixturePort}`;
const child = spawn(process.execPath, ["apps/api/dist/server.js"], {
  cwd: resolve("."),
  env: {
    ...process.env,
    API_PORT: String(apiPort),
    FRONTEND_ORIGIN: webUrl,
    ACCESOQA_DB_PATH: join(directory, "production.sqlite"),
  },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});
let logs = "";
child.stdout.on("data", (data) => {
  logs += String(data);
});
child.stderr.on("data", (data) => {
  logs += String(data);
});
const exited = new Promise<void>((resolve) =>
  child.once("exit", () => resolve()),
);
const started = Date.now();
async function json(path: string, payload?: unknown) {
  const response = await fetch(apiUrl + path, {
    headers: { "Content-Type": "application/json", Origin: webUrl },
    ...(payload ? { method: "POST", body: JSON.stringify(payload) } : {}),
  });
  assert(
    response.ok,
    `${path}: ${response.status} ${await response.clone().text()}`,
  );
  return (await response.json()) as unknown;
}
async function waitRun(id: string) {
  for (let i = 0; i < 200; i++) {
    const run = AuditRunSchema.parse(await json(`/api/audits/${id}`));
    if (run.status === "failed")
      throw new Error(run.errorMessage ?? "Auditoría fallida");
    if (run.status === "completed") return run;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("Timeout esperando auditoría");
}
try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(apiUrl + "/api/health")).ok) break;
    } catch {
      /* Wait for local startup. */
    }
    if (child.exitCode !== null) throw new Error(logs);
    if (i === 59) throw new Error("La API no inició: " + logs);
    await new Promise((r) => setTimeout(r, 250));
  }
  fixture = await preview({
    root: resolve("apps/fixture"),
    configFile: resolve("apps/fixture/vite.config.ts"),
    preview: { host: "127.0.0.1", port: fixturePort, strictPort: true },
    logLevel: "error",
  });
  web = await preview({
    root: resolve("apps/web"),
    configFile: resolve("apps/web/vite.config.ts"),
    preview: {
      host: "127.0.0.1",
      port: webPort,
      strictPort: true,
      proxy: { "/api": apiUrl },
    },
    logLevel: "error",
  });
  const bad = ProjectSchema.parse(
    await json("/api/projects", {
      name: "Demostración con problemas",
      baseUrl: fixtureUrl + "/?modo=problemas",
    }),
  );
  const badQueued = AuditRunSchema.parse(
    await json(`/api/projects/${bad.id}/audits`, {}),
  );
  const badRun = await waitRun(badQueued.id);
  assert.deepEqual(badRun.findings.map((f) => f.ruleId).sort(), [
    "color-contrast",
    "image-alt",
    "label",
  ]);
  const good = ProjectSchema.parse(
    await json("/api/projects", {
      name: "Demostración corregida",
      baseUrl: fixtureUrl + "/?modo=corregido",
    }),
  );
  const goodRun = await waitRun(
    AuditRunSchema.parse(await json(`/api/projects/${good.id}/audits`, {})).id,
  );
  assert.equal(goodRun.findings.length, 0);
  const flow = FlowSchema.parse(
    await json(`/api/projects/${good.id}/flows`, {
      name: "Registro de demostración",
      testDataOnly: true,
      steps: [
        {
          action: "navigate",
          path: "/registro?modo=corregido",
          label: "Abrir registro",
          checkpoint: true,
          timeoutMs: 15000,
        },
        {
          action: "fill",
          locator: { by: "label", value: "Nombre completo" },
          template: "name",
          label: "Nombre ficticio",
        },
        {
          action: "fill",
          locator: { by: "label", value: "Correo electrónico" },
          template: "email",
          label: "Correo ficticio",
        },
        {
          action: "click",
          locator: { by: "role", role: "button", name: "Crear cuenta" },
          label: "Crear cuenta",
        },
        {
          action: "visible",
          locator: { by: "testId", value: "registration-success" },
          label: "Confirmación",
          checkpoint: true,
          timeoutMs: 15000,
        },
      ],
    }),
  );
  const flowRun = await waitRun(
    AuditRunSchema.parse(await json(`/api/flows/${flow.id}/audits`, {})).id,
  );
  assert.equal(flowRun.steps.filter((s) => s.status === "completed").length, 5);
  assert.equal(flowRun.checkpoints.length, 2);
  const exported = AuditReportSchema.parse(
    await json(`/api/audits/${badRun.id}/export.json`),
  );
  assert.equal(exported.run.id, badRun.id);
  assert.equal(exported.summary.total, 3);
  browser = await chromium.launch();
  const views = [];
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
        viewport: { width, height: 1000 },
      }),
      page = await context.newPage();
    try {
      await page.goto(webUrl);
      await page
        .getByRole("button", { name: "Ejecutar auditoría", exact: true })
        .waitFor();
      await page.locator("#historial .history-list button").first().waitFor();
      const result = await new AxeBuilder({ page }).analyze();
      assert.equal(
        result.violations.length,
        0,
        JSON.stringify(
          result.violations.map((v) => ({
            rule: v.id,
            nodes: v.nodes.map((n) => n.target),
          })),
        ),
      );
      const overflow = await page.evaluate(() => ({
        width: innerWidth,
        scroll: document.documentElement.scrollWidth,
        elements: [...document.querySelectorAll("body *")]
          .filter((e) => e.getBoundingClientRect().right > innerWidth + 1)
          .map((e) => ({
            tag: e.tagName,
            class: e.className,
            text: e.textContent?.slice(0, 100),
            right: e.getBoundingClientRect().right,
          }))
          .slice(0, 15),
      }));
      assert(overflow.scroll <= overflow.width, JSON.stringify(overflow));
      mkdirSync("data/screenshots", { recursive: true });
      await page.screenshot({
        path: `data/screenshots/mvp-production-${width}.png`,
        fullPage: true,
      });
      views.push({
        width,
        axeViolations: result.violations.length,
        horizontalOverflow: false,
      });
    } finally {
      await context.close();
    }
  }
  const evidence = {
    checkedAt: new Date().toISOString(),
    runtime: process.version,
    api: "compiled dist/server.js",
    web: "Vite preview dist",
    fixture: "Vite preview dist",
    brokenRules: badRun.findings.map((f) => f.ruleId),
    correctedFindings: goodRun.findings.length,
    flowCompletedSteps: flowRun.steps.length,
    flowCheckpoints: flowRun.checkpoints.length,
    jsonUniqueElements: exported.summary.total,
    views,
    durationMs: Date.now() - started,
  };
  mkdirSync("data/reports", { recursive: true });
  writeFileSync(
    "data/reports/mvp-production-verification.json",
    JSON.stringify(evidence, null, 2),
  );
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  await browser?.close();
  await Promise.all(
    [web, fixture]
      .filter((v): v is PreviewServer => Boolean(v))
      .map(
        (v) =>
          new Promise<void>((r) => {
            v.httpServer.close(() => r());
            if ("closeAllConnections" in v.httpServer)
              v.httpServer.closeAllConnections();
          }),
      ),
  );
  child.kill("SIGTERM");
  await exited;
  rmSync(directory, { recursive: true, force: true });
}
