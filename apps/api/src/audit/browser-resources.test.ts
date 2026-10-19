import http from "node:http";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import type { Browser } from "playwright";
import { withAuditPage } from "./browser.js";
describe("limpieza real de recursos de Chromium", () => {
  let server: http.Server, url: string;
  beforeAll(async () => {
    server = http.createServer((_req, res) =>
      res.end(
        "<!doctype html><html lang='es'><title>Recursos</title><h1>Prueba</h1></html>",
      ),
    );
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Puerto ausente");
    url = `http://127.0.0.1:${address.port}/`;
  });
  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });
  it.each(["success", "failure", "timeout"])(
    "cierra el navegador tras %s y permite otra auditoría",
    async (mode) => {
      let browser: Browser | null = null;
      const work = withAuditPage(
        mode === "timeout" ? 5000 : 15000,
        async (page) => {
          browser = page.context().browser();
          await page.goto(url);
          if (mode === "failure") throw new Error("Fallo deliberado");
          if (mode === "timeout") await page.waitForTimeout(20000);
          return true;
        },
      );
      if (mode === "success") await expect(work).resolves.toBe(true);
      else
        await expect(work).rejects.toThrow(
          mode === "failure" ? "Fallo deliberado" : "superó el límite",
        );
      expect(browser).not.toBeNull();
      expect((browser as unknown as Browser).isConnected()).toBe(false);
      await expect(
        withAuditPage(15000, async (page) => {
          await page.goto(url);
          return page.title();
        }),
      ).resolves.toBe("Recursos");
    },
    30000,
  );
});
