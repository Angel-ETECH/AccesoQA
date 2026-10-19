import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type ViteDevServer } from "vite";
import {
  AuditRunSchema,
  FlowSchema,
  ProjectSchema,
  type AuditRun,
  type FlowStepInput,
} from "@accesoqa/shared";
import { buildServer } from "../server.js";

describe("flujos declarativos reales", () => {
  let fixture: ViteDevServer;
  let app: ReturnType<typeof buildServer>;
  let directory: string;
  let projectId: string;
  const transitions = new Set<string>();
  function registration(broken = false): FlowStepInput[] {
    return [
      {
        action: "navigate",
        label: "Abrir registro",
        path: `/registro?modo=${broken ? "problemas" : "corregido"}`,
        checkpoint: true,
        timeoutMs: 15000,
      },
      {
        action: "fill",
        label: "Nombre ficticio",
        locator: broken
          ? { by: "testId", value: "registration-name" }
          : { by: "label", value: "Nombre completo" },
        template: "name",
        checkpoint: false,
        timeoutMs: 5000,
      },
      {
        action: "fill",
        label: "Correo ficticio",
        locator: { by: "label", value: "Correo electrónico" },
        template: "email",
        checkpoint: false,
        timeoutMs: 5000,
      },
      {
        action: "click",
        label: "Crear cuenta",
        locator: { by: "role", role: "button", name: "Crear cuenta" },
        checkpoint: false,
        timeoutMs: 5000,
      },
      {
        action: "visible",
        label: "Evaluar confirmación",
        locator: { by: "testId", value: "registration-success" },
        checkpoint: true,
        timeoutMs: 15000,
      },
    ];
  }
  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), "accesoqa-flow-"));
    const reservation = http.createServer();
    await new Promise<void>((resolve) =>
      reservation.listen(0, "127.0.0.1", resolve),
    );
    const address = reservation.address();
    if (!address || typeof address === "string")
      throw new Error("Puerto ausente");
    await new Promise<void>((resolve) => reservation.close(() => resolve()));
    fixture = await createServer({
      cacheDir: join(directory, "fixture-vite-cache"),
      root: fileURLToPath(new URL("../../../fixture", import.meta.url)),
      configFile: false,
      logLevel: "error",
      server: {
        host: "127.0.0.1",
        port: address.port,
        strictPort: true,
        hmr: false,
      },
    });
    await fixture.listen();
    app = buildServer({
      databasePath: join(directory, "flows.sqlite"),
      logger: false,
    });
    projectId = ProjectSchema.parse(
      (
        await app.inject({
          method: "POST",
          url: "/api/projects",
          payload: {
            name: "Registro local",
            baseUrl: `http://127.0.0.1:${address.port}/?modo=corregido`,
          },
        })
      ).json(),
    ).id;
  }, 30000);
  afterAll(async () => {
    await app?.close();
    await fixture?.close();
    if (directory) rmSync(directory, { recursive: true, force: true });
  });
  async function create(steps = registration(), name = "Registro de usuario") {
    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/flows`,
      payload: { name, testDataOnly: true, steps },
    });
    expect(response.statusCode, response.body).toBe(201);
    return FlowSchema.parse(response.json());
  }
  async function finish(id: string): Promise<AuditRun> {
    const deadline = Date.now() + 125000;
    while (Date.now() < deadline) {
      const run = AuditRunSchema.parse(
        (await app.inject({ url: `/api/audits/${id}` })).json(),
      );
      for (const step of run.steps) transitions.add(step.status);
      if (["completed", "failed"].includes(run.status)) return run;
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    throw new Error("El flujo no finalizó");
  }
  async function start(id: string) {
    const response = await app.inject({
      method: "POST",
      url: `/api/flows/${id}/audits`,
      payload: {},
    });
    expect(response.statusCode, response.body).toBe(202);
    return AuditRunSchema.parse(response.json());
  }

  it("registra datos ficticios, ejecuta todos los pasos y conserva dos pantallas", async () => {
    const flow = await create();
    const queued = await start(flow.id);
    expect(queued.steps.map((step) => step.status)).toEqual(
      Array(5).fill("pending"),
    );
    const duplicate = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/audits`,
      payload: {},
    });
    expect(duplicate.statusCode).toBe(409);
    const run = await finish(queued.id);
    expect(run.status, run.errorMessage ?? "").toBe("completed");
    expect(run.steps.map((step) => step.status)).toEqual(
      Array(5).fill("completed"),
    );
    expect(run.checkpoints.map((checkpoint) => checkpoint.position)).toEqual([
      1, 5,
    ]);
    expect(run.checkpoints[0]?.url).toContain("/registro");
    expect(run.checkpoints[1]?.url).toContain("/confirmacion");
    expect(run.checkpoints[1]?.pageTitle).toContain("Registro completado");
    expect(run.findings).toEqual([]);
    expect(run.findingsCount).toBe(0);
    expect(transitions.has("running")).toBe(true);
    expect(
      (
        await app.inject({ url: `/api/projects/${projectId}/audits/latest` })
      ).json(),
    ).toBeNull();
    expect(
      AuditRunSchema.parse(
        (
          await app.inject({ url: `/api/flows/${flow.id}/audits/latest` })
        ).json(),
      ),
    ).toEqual(run);
    const edited = await app.inject({
      method: "PUT",
      url: `/api/flows/${flow.id}`,
      payload: {
        name: "Registro editado",
        testDataOnly: true,
        steps: [
          registration()[0]!,
          registration()[2]!,
          registration()[1]!,
          ...registration().slice(3),
        ],
      },
    });
    expect(edited.statusCode).toBe(200);
    expect(FlowSchema.parse(edited.json()).steps[1]?.definition.label).toBe(
      "Correo ficticio",
    );
    expect(
      AuditRunSchema.parse(
        (await app.inject({ url: `/api/audits/${run.id}` })).json(),
      ).steps[1]?.label,
    ).toBe("Nombre ficticio");
    expect(
      (await app.inject({ url: `/api/projects/${projectId}/flows` }))
        .statusCode,
    ).toBe(200);
    const individual = AuditRunSchema.parse(
      (
        await app.inject({
          method: "POST",
          url: `/api/projects/${projectId}/audits`,
          payload: {},
        })
      ).json(),
    );
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/flows/${flow.id}/audits`,
          payload: {},
        })
      ).statusCode,
    ).toBe(409);
    expect((await finish(individual.id)).status).toBe("completed");
  }, 60000);
  it("compara hallazgos reales entre registro y confirmación con defectos", async () => {
    const flow = await create(registration(true), "Registro con problemas");
    const run = await finish((await start(flow.id)).id);
    expect(run.status, run.errorMessage ?? "").toBe("completed");
    expect(
      run.checkpoints[0]?.findings.map((finding) => finding.ruleId),
    ).toEqual(expect.arrayContaining(["image-alt", "label", "color-contrast"]));
    expect(
      run.checkpoints[1]?.findings.map((finding) => finding.ruleId),
    ).toContain("button-name");
    expect(
      run.checkpoints[1]?.findings.map((finding) => finding.ruleId),
    ).not.toContain("image-alt");
    expect(
      run.findings.find((finding) => finding.ruleId === "button-name")
        ?.stepPosition,
    ).toBe(5);
    expect(
      run.findings.every(
        (finding) => finding.checkpointId && finding.stepLabel,
      ),
    ).toBe(true);
  }, 60000);
  it.each([
    {
      action: "click" as const,
      locator: { by: "testId" as const, value: "no-existe" },
      name: "selector inexistente",
    },
    {
      action: "visible" as const,
      locator: { by: "testId" as const, value: "not-visible" },
      name: "timeout de visibilidad",
    },
  ])(
    "identifica el paso con $name y no ejecuta los posteriores",
    async ({ action, locator, name }) => {
      const steps: FlowStepInput[] = [
        registration(action === "click")[0]!,
        { action, label: name, locator, checkpoint: true, timeoutMs: 1000 },
        registration()[2]!,
      ];
      const flow = await create(steps, name);
      const run = await finish((await start(flow.id)).id);
      expect(run.status).toBe("failed");
      expect(run.findingsCount).toBeNull();
      expect(run.steps.map((step) => step.status)).toEqual([
        "completed",
        "failed",
        "skipped",
      ]);
      expect(run.steps[1]?.errorMessage).toMatch(/Paso 2/);
      expect(run.steps[1]?.errorMessage).toMatch(/Timeout/);
      expect(run.steps[2]?.startedAt).toBeNull();
      expect(run.steps[2]?.finishedAt).toBeNull();
      expect(run.checkpoints).toHaveLength(1);
      expect(run.findings.length).toBe(action === "click" ? 3 : 0);
    },
    60000,
  );
  it("rechaza código, comandos, selectores libres, valores privados y límites inválidos", async () => {
    const cases: unknown[][] = [
      [{ ...registration()[0], action: "javascript", script: "alert(1)" }],
      [{ ...registration()[0], command: "cmd.exe" }],
      [{ ...registration()[0], path: "https://example.invalid/" }],
      [{ ...registration()[0], path: "//example.invalid/" }],
      [{ ...registration()[0], timeoutMs: 15001 }],
      [{ ...registration()[0], checkpoint: false }],
      Array(21).fill(registration()[0]),
      [
        registration()[0],
        { ...registration()[1], locator: { by: "css", value: "#name" } },
      ],
      [registration()[0], { ...registration()[1], value: "contraseña-real" }],
      [registration()[0], { ...registration()[1], template: "secreto-real" }],
      [registration()[1]],
    ];
    for (const steps of cases)
      expect(
        (
          await app.inject({
            method: "POST",
            url: `/api/projects/${projectId}/flows`,
            payload: { name: "Inválido", testDataOnly: true, steps },
          })
        ).statusCode,
      ).toBe(400);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/projects/${projectId}/flows`,
          payload: {
            name: "No confirmado",
            testDataOnly: false,
            steps: registration(),
          },
        })
      ).statusCode,
    ).toBe(400);
  });
});
