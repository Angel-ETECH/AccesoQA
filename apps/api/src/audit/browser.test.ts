import { describe, it, expect, vi, afterEach } from "vitest";
import { chromium, type Browser } from "playwright";
import { withAuditPage } from "./browser.js";
afterEach(() => vi.restoreAllMocks());
describe("ciclo de vida y errores de Chromium", () => {
  it("explica cómo instalar Chromium si falta el ejecutable", async () => {
    vi.spyOn(chromium, "launch").mockRejectedValueOnce(
      new Error("Executable doesn't exist"),
    );
    await expect(withAuditPage(1000, async () => true)).rejects.toThrow(
      "npx playwright install chromium",
    );
  });
  it("convierte el cierre inesperado en un mensaje comprensible", async () => {
    vi.spyOn(chromium, "launch").mockRejectedValueOnce(
      new Error("Target browser has been closed"),
    );
    await expect(withAuditPage(1000, async () => true)).rejects.toThrow(
      "Chromium no pudo iniciar",
    );
  });
  it("cierra un navegador que termina de lanzarse después del timeout", async () => {
    const close = vi.fn().mockResolvedValue(undefined),
      newContext = vi.fn();
    vi.spyOn(chromium, "launch").mockImplementationOnce(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { close, newContext } as unknown as Browser;
    });
    await expect(withAuditPage(10, async () => true)).rejects.toThrow(
      "superó el límite",
    );
    expect(close).toHaveBeenCalledOnce();
    expect(newContext).not.toHaveBeenCalled();
  });
});
