import http from "node:http";
import AxeBuilder from "@axe-core/playwright";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type ViteDevServer } from "vite";
import { chromium, type Browser } from "playwright";
import { buildServer } from "../server.js";

async function freePort() {
  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Puerto ausente");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

describe("recorrido completo de la interfaz con auditoría real", () => {
  let web: ViteDevServer;
  let fixture: ViteDevServer;
  let app: ReturnType<typeof buildServer>;
  let browser: Browser;
  let directory: string;
  let webUrl: string;
  let fixtureUrl: string;
  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), "accesoqa-ui-"));
    const webPort = await freePort();
    const fixturePort = await freePort();
    webUrl = `http://127.0.0.1:${webPort}`;
    fixtureUrl = `http://127.0.0.1:${fixturePort}`;
    app = buildServer({
      databasePath: join(directory, "ui.sqlite"),
      logger: false,
      frontendOrigin: webUrl,
    });
    const apiUrl = await app.listen({ host: "127.0.0.1", port: 0 });
    fixture = await createServer({
      cacheDir: join(directory, "fixture-vite-cache"),
      root: fileURLToPath(new URL("../../../fixture", import.meta.url)),
      configFile: false,
      server: {
        host: "127.0.0.1",
        port: fixturePort,
        strictPort: true,
        hmr: false,
      },
      logLevel: "error",
    });
    await fixture.listen();
    web = await createServer({
      cacheDir: join(directory, "web-vite-cache"),
      optimizeDeps: {
        noDiscovery: true,
        include: [
          "react",
          "react-dom/client",
          "react/jsx-runtime",
          "react/jsx-dev-runtime",
          "lucide-react",
          "zod",
        ],
      },
      root: fileURLToPath(new URL("../../../web", import.meta.url)),
      configFile: fileURLToPath(
        new URL("../../../web/vite.config.ts", import.meta.url),
      ),
      server: {
        host: "127.0.0.1",
        port: webPort,
        strictPort: true,
        hmr: false,
        proxy: { "/api": apiUrl },
      },
      logLevel: "error",
    });
    await web.listen();
    browser = await chromium.launch({ headless: true });
  }, 30000);
  afterAll(async () => {
    await browser?.close();
    await web?.close();
    await fixture?.close();
    await app?.close();
    if (directory) rmSync(directory, { recursive: true, force: true });
  });

  it.each([
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ])(
    "registra, ejecuta, filtra y muestra detalles en $width px",
    async (viewport) => {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      try {
        await page.goto(webUrl);
        await page
          .getByLabel("Nombre del proyecto", { exact: true })
          .fill(`Fixture ${viewport.width}`);
        await page
          .getByLabel("URL de la página autorizada")
          .fill(`${fixtureUrl}/?modo=problemas`);
        await page
          .getByRole("button", { name: "Registrar proyecto", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Ejecutar auditoría", exact: true })
          .waitFor({ state: "visible" });
        await page
          .getByRole("button", { name: "Ejecutar auditoría", exact: true })
          .click();
        await page
          .getByText("Completada", { exact: true })
          .waitFor({ timeout: 55000 });
        const imageRule = page.locator("tbody tr").filter({
          has: page.getByRole("rowheader", {
            name: "image-alt",
            exact: true,
          }),
        });
        await imageRule.locator("summary").click();
        expect(await imageRule.locator("pre").allTextContents()).toEqual(
          expect.arrayContaining([expect.stringContaining("sample.svg")]),
        );
        expect(await imageRule.getByRole("link").getAttribute("href")).toMatch(
          /^https:\/\//,
        );
        await page.getByLabel("Filtrar por impacto").selectOption("critical");
        await expect
          .poll(
            async () => {
              const rows = await page.locator("tbody tr").count();
              return (
                rows > 0 &&
                rows === (await page.locator("tbody .impact-critical").count())
              );
            },
            { timeout: 5000 },
          )
          .toBe(true);
        await page.getByLabel("Filtrar por impacto").selectOption("all");
        await page
          .getByRole("rowheader", { name: "color-contrast", exact: true })
          .waitFor();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth + 1,
          ),
        ).toBe(true);
        expect(
          (await new AxeBuilder({ page }).analyze()).violations.map((v) => ({
            id: v.id,
            nodes: v.nodes.map((n) => n.target),
          })),
        ).toEqual([]);
        if (viewport.width < 760) {
          await page.getByRole("button", { name: "Abrir navegación" }).click();
          expect(
            await page.locator(".sidebar").getAttribute("class"),
          ).toContain("sidebar-open");
          await page.getByRole("link", { name: /Auditoría de página/ }).click();
          expect(
            await page.locator(".sidebar").getAttribute("class"),
          ).not.toContain("sidebar-open");
        }
        const screenshotDirectory = fileURLToPath(
          new URL("../../../../data/screenshots/", import.meta.url),
        );
        mkdirSync(screenshotDirectory, { recursive: true });
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.locator(".table-scroll").evaluate((element) => {
          element.scrollLeft = 0;
        });
        await page.screenshot({
          path: join(screenshotDirectory, `fase2-${viewport.width}.png`),
          fullPage: true,
          animations: "disabled",
        });
        await page.reload();
        await page
          .getByText("Completada", { exact: true })
          .waitFor({ timeout: 10000 });
        expect(
          await page
            .getByRole("rowheader", { name: "image-alt", exact: true })
            .count(),
        ).toBe(1);
        await page
          .getByLabel("Nombre del proyecto", { exact: true })
          .fill("Destino externo rechazado");
        await page
          .getByLabel("URL de la página autorizada")
          .fill("https://example.invalid");
        await page
          .getByRole("button", { name: "Registrar proyecto", exact: true })
          .click();
        await page
          .getByRole("alert")
          .filter({ hasText: "Solo se permiten" })
          .waitFor();
        expect(errors).toEqual([]);
      } finally {
        await context.close();
      }
    },
    60000,
  );

  it.each([
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ])(
    "crea, ordena y ejecuta un flujo desde el editor a $width px",
    async (viewport) => {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      try {
        await page.goto(webUrl);
        await page
          .getByLabel("Nombre del proyecto", { exact: true })
          .fill(`Proyecto de flujo ${viewport.width}`);
        await page
          .getByLabel("URL de la página autorizada")
          .fill(`${fixtureUrl}/?modo=corregido`);
        await page
          .getByRole("button", { name: "Registrar proyecto", exact: true })
          .click();
        await page
          .getByRole("option", {
            name: `Proyecto de flujo ${viewport.width}`,
            exact: true,
          })
          .waitFor({ state: "attached" });
        const panel = page.locator("#flujos");
        await panel
          .getByRole("button", { name: "Nuevo flujo", exact: true })
          .click();
        await panel
          .getByRole("button", { name: "Cargar ejemplo de registro" })
          .click();
        await panel
          .getByRole("button", { name: "Subir paso 3", exact: true })
          .click();
        expect(
          await panel
            .getByRole("group", { name: "Paso 2", exact: true })
            .getByLabel("Nombre del paso")
            .inputValue(),
        ).toBe("Completar correo ficticio");
        await panel
          .getByRole("button", { name: "Agregar paso", exact: true })
          .click();
        const sixth = panel.getByRole("group", { name: "Paso 6", exact: true });
        await sixth.getByLabel("Nombre del paso").fill("Confirmación final");
        await sixth
          .getByLabel("Acción", { exact: true })
          .selectOption("visible");
        await sixth
          .getByLabel("Localizador", { exact: true })
          .selectOption("testId");
        await sixth
          .getByLabel("Identificador de prueba")
          .fill("registration-success");
        await sixth
          .getByLabel("Auditar accesibilidad después de este paso")
          .check();
        await panel
          .getByLabel(
            "Confirmo que usaré exclusivamente datos de prueba en una aplicación autorizada.",
          )
          .check();
        await panel
          .getByRole("button", { name: "Guardar flujo", exact: true })
          .click();
        await panel
          .getByRole("option", { name: "Registro de usuario", exact: true })
          .waitFor({ state: "attached" });
        await panel
          .getByRole("button", { name: "Ejecutar flujo", exact: true })
          .click();
        await panel
          .getByText("Completada", { exact: true })
          .waitFor({ timeout: 125000 });
        expect(await panel.locator(".flow-timeline li").count()).toBe(6);
        expect(await panel.locator(".step-completed").count()).toBe(6);
        expect(await panel.getByTestId("flow-step-2").innerText()).toContain(
          "Completar correo ficticio",
        );
        expect(await panel.locator(".checkpoint-details").count()).toBe(3);
        await panel
          .getByRole("button", { name: "Editar flujo", exact: true })
          .click();
        expect(
          await panel
            .getByRole("group", { name: "Paso 6", exact: true })
            .getByLabel("Nombre del paso")
            .inputValue(),
        ).toBe("Confirmación final");
        await panel.getByRole("button", { name: "Cancelar edición" }).click();
        await panel
          .locator(".checkpoint-details")
          .last()
          .locator("summary")
          .click();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth + 1,
          ),
        ).toBe(true);
        const screenshots = fileURLToPath(
          new URL("../../../../data/screenshots/", import.meta.url),
        );
        mkdirSync(screenshots, { recursive: true });
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({
          path: join(screenshots, `fase3-${viewport.width}.png`),
          fullPage: true,
          animations: "disabled",
        });
        await page.reload();
        await page
          .locator("#flujos")
          .getByText("Completada", { exact: true })
          .waitFor({ timeout: 10000 });
        expect(await page.locator("#flujos .step-completed").count()).toBe(6);
        expect(errors).toEqual([]);
      } finally {
        await context.close();
      }
    },
    150000,
  );

  it("muestra el paso fallido, los no ejecutados y los resultados parciales de un flujo", async () => {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    const page = await context.newPage();
    try {
      await page.goto(webUrl);
      await page
        .getByLabel("Nombre del proyecto", { exact: true })
        .fill("Proyecto de flujo fallido");
      await page
        .getByLabel("URL de la página autorizada")
        .fill(`${fixtureUrl}/?modo=problemas`);
      await page
        .getByRole("button", { name: "Registrar proyecto", exact: true })
        .click();
      await page
        .getByRole("option", { name: "Proyecto de flujo fallido", exact: true })
        .waitFor({ state: "attached" });
      const panel = page.locator("#flujos");
      await panel
        .getByRole("button", { name: "Nuevo flujo", exact: true })
        .click();
      await panel
        .getByRole("button", { name: "Cargar ejemplo de registro" })
        .click();
      await panel
        .getByRole("group", { name: "Paso 1", exact: true })
        .getByLabel("Ruta local")
        .fill("/registro?modo=problemas");
      const second = panel.getByRole("group", { name: "Paso 2", exact: true });
      await second
        .getByLabel("Nombre del paso")
        .fill("Localizador inexistente");
      await second
        .getByLabel("Localizador", { exact: true })
        .selectOption("testId");
      await second.getByLabel("Identificador de prueba").fill("no-existe");
      await second.getByLabel("Tiempo máximo (segundos)").selectOption("1000");
      await panel
        .getByLabel(
          "Confirmo que usaré exclusivamente datos de prueba en una aplicación autorizada.",
        )
        .check();
      await panel
        .getByRole("button", { name: "Guardar flujo", exact: true })
        .click();
      await panel
        .getByRole("option", { name: "Registro de usuario", exact: true })
        .waitFor({ state: "attached" });
      await panel
        .getByRole("button", { name: "Ejecutar flujo", exact: true })
        .click();
      await panel
        .getByText("Fallida", { exact: true })
        .waitFor({ timeout: 55000 });
      expect(await panel.locator(".step-completed").count()).toBe(1);
      expect(await panel.locator(".step-failed").count()).toBe(1);
      expect(await panel.locator(".step-skipped").count()).toBe(3);
      expect(await panel.getByTestId("flow-step-2").innerText()).toContain(
        "Timeout",
      );
      expect(await panel.getByRole("alert").innerText()).toContain("Paso 2");
      expect(await panel.locator(".checkpoint-details").count()).toBe(1);
      expect(await panel.locator(".screen-comparison tbody tr").count()).toBe(
        3,
      );
    } finally {
      await context.close();
    }
  }, 60000);

  it("presenta un fallo sin tabla de incidencias ni mensaje de resultado limpio", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await page.goto(webUrl);
      await page
        .getByLabel("Nombre del proyecto", { exact: true })
        .fill("Página inaccesible");
      await page
        .getByLabel("URL de la página autorizada")
        .fill(`http://127.0.0.1:${await freePort()}/`);
      await page
        .getByRole("button", { name: "Registrar proyecto", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Ejecutar auditoría", exact: true })
        .click();
      await page
        .getByText("Fallida", { exact: true })
        .waitFor({ timeout: 55000 });
      expect(await page.getByRole("alert").innerText()).toContain(
        "no significa que la página esté libre",
      );
      expect(await page.getByRole("table").count()).toBe(0);
      expect(
        await page
          .getByText("Axe-core no detectó incidencias automáticas")
          .count(),
      ).toBe(0);
    } finally {
      await context.close();
    }
  }, 60000);
  it("consulta el historial, compara revisiones y descarga JSON desde la interfaz", async () => {
    const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
      }),
      page = await context.newPage();
    try {
      await page.goto(webUrl);
      await page
        .getByLabel("Nombre del proyecto", { exact: true })
        .fill("Historial UI");
      await page
        .getByLabel("URL de la página autorizada")
        .fill(fixtureUrl + "/?modo=corregido");
      await page
        .getByRole("button", { name: "Registrar proyecto", exact: true })
        .click();
      await page.locator("#historial").waitFor();
      const projects = (await app.inject("/api/projects")).json() as {
        id: string;
        name: string;
      }[];
      const project = projects.find((p) => p.name === "Historial UI")!;
      const flow = (
        await app.inject({
          method: "POST",
          url: "/api/projects/" + project.id + "/flows",
          payload: {
            name: "Historial registro",
            testDataOnly: true,
            steps: [
              {
                action: "navigate",
                path: "/registro?modo=corregido",
                label: "Registro",
                checkpoint: true,
                timeoutMs: 15000,
              },
            ],
          },
        })
      ).json() as { id: string };
      const ids: string[] = [];
      for (let i = 0; i < 2; i++) {
        const run = (
          await app.inject({
            method: "POST",
            url: "/api/flows/" + flow.id + "/audits",
          })
        ).json() as { id: string };
        ids.push(run.id);
        await expect
          .poll(
            async () =>
              (
                (await app.inject("/api/audits/" + run.id)).json() as {
                  status: string;
                }
              ).status,
            { timeout: 30000 },
          )
          .toBe("completed");
      }
      const panel = page.locator("#historial");
      await panel.getByRole("button", { name: "Actualizar historial" }).click();
      await expect
        .poll(() => panel.locator(".history-list>div").count())
        .toBe(2);
      await panel.getByLabel("Base de comparación").selectOption(ids[0]!);
      await panel.getByLabel("Revisión posterior").selectOption(ids[1]!);
      await panel.getByRole("button", { name: "Comparar ejecuciones" }).click();
      await panel
        .getByRole("heading", { name: "Comparación: Completa", exact: true })
        .waitFor();
      await panel.locator(".history-list button").first().click();
      await panel
        .getByRole("heading", { name: "Ejecución " + ids[1] })
        .waitFor();
      const download = page.waitForEvent("download");
      await panel.getByRole("link", { name: "Exportar JSON" }).click();
      expect((await download).suggestedFilename()).toBe(
        "accesoqa-" + ids[1] + ".json",
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
    } finally {
      await context.close();
    }
  }, 60000);
  it.each([1440, 390])(
    "audita el propio panel con axe y teclado a %s px",
    async (width) => {
      const context = await browser.newContext({
          viewport: { width, height: 1000 },
        }),
        page = await context.newPage();
      try {
        await page.goto(webUrl);
        await page.getByLabel("Nombre del proyecto", { exact: true }).waitFor();
        await page.keyboard.press("Tab");
        expect(await page.locator(":focus").innerText()).toBe(
          "Saltar al contenido",
        );
        await page.keyboard.press("Enter");
        const violations = (
          await new AxeBuilder({ page }).analyze()
        ).violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          nodes: v.nodes.map((n) => ({
            target: n.target,
            summary: n.failureSummary,
          })),
        }));
        expect(violations).toEqual([]);
        if (width === 390) {
          await page
            .getByRole("button", { name: "Abrir navegación", exact: true })
            .click();
          expect(
            (await new AxeBuilder({ page }).analyze()).violations.map((v) => ({
              id: v.id,
              nodes: v.nodes.map((n) => n.target),
            })),
          ).toEqual([]);
          await page.keyboard.press("Escape");
          expect(
            await page
              .getByRole("button", { name: "Abrir navegación", exact: true })
              .getAttribute("aria-expanded"),
          ).toBe("false");
          expect(await page.locator(":focus").getAttribute("aria-label")).toBe(
            "Abrir navegación",
          );
        }
      } finally {
        await context.close();
      }
    },
    30000,
  );

  it("solicita confirmación antes de eliminar un paso del editor", async () => {
    const context = await browser.newContext(),
      page = await context.newPage();
    try {
      await page.goto(webUrl);
      await page.locator("#flujos").waitFor();
      const panel = page.locator("#flujos");
      await panel
        .getByRole("button", { name: "Nuevo flujo", exact: true })
        .click();
      await panel
        .getByRole("button", { name: "Agregar paso", exact: true })
        .click();
      expect(
        (await new AxeBuilder({ page }).analyze()).violations.map((v) => ({
          id: v.id,
          nodes: v.nodes.map((n) => n.target),
        })),
      ).toEqual([]);
      page.once("dialog", (dialog) => void dialog.dismiss());
      await panel
        .getByRole("button", { name: "Eliminar paso 2", exact: true })
        .click();
      expect(await panel.locator("fieldset").count()).toBe(2);
      page.once("dialog", (dialog) => void dialog.accept());
      await panel
        .getByRole("button", { name: "Eliminar paso 2", exact: true })
        .click();
      expect(await panel.locator("fieldset").count()).toBe(1);
    } finally {
      await context.close();
    }
  }, 30000);
  it("confirma el reemplazo de la definición del flujo", async () => {
    const project = (
      await app.inject({
        method: "POST",
        url: "/api/projects",
        payload: {
          name: "Confirmación de edición",
          baseUrl: fixtureUrl + "/?modo=corregido",
        },
      })
    ).json() as { id: string };
    const flow = (
      await app.inject({
        method: "POST",
        url: "/api/projects/" + project.id + "/flows",
        payload: {
          name: "Definición original",
          testDataOnly: true,
          steps: [
            {
              action: "navigate",
              path: "/registro?modo=corregido",
              label: "Abrir registro",
              checkpoint: true,
              timeoutMs: 15000,
            },
          ],
        },
      })
    ).json() as { id: string };
    const context = await browser.newContext(),
      page = await context.newPage();
    try {
      await page.goto(webUrl);
      const panel = page.locator("#flujos");
      await panel
        .getByRole("button", { name: "Editar flujo", exact: true })
        .click();
      await panel
        .getByLabel("Nombre del flujo", { exact: true })
        .fill("Definición revisada");
      await panel
        .getByLabel(
          "Confirmo que usaré exclusivamente datos de prueba en una aplicación autorizada.",
        )
        .check();
      page.once("dialog", (dialog) => void dialog.dismiss());
      await panel
        .getByRole("button", { name: "Guardar cambios del flujo", exact: true })
        .click();
      let saved = (
        await app.inject("/api/projects/" + project.id + "/flows")
      ).json() as { id: string; name: string }[];
      expect(saved.find((f) => f.id === flow.id)?.name).toBe(
        "Definición original",
      );
      page.once("dialog", (dialog) => void dialog.accept());
      await panel
        .getByRole("button", { name: "Guardar cambios del flujo", exact: true })
        .click();
      await panel
        .getByRole("option", { name: "Definición revisada", exact: true })
        .waitFor({ state: "attached" });
      saved = (
        await app.inject("/api/projects/" + project.id + "/flows")
      ).json() as { id: string; name: string }[];
      expect(saved.find((f) => f.id === flow.id)?.name).toBe(
        "Definición revisada",
      );
    } finally {
      await context.close();
    }
  }, 30000);
});
