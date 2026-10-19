import { afterEach, describe, it, expect, vi } from "vitest";
import { api } from "./api";
afterEach(() => vi.unstubAllGlobals());
describe("mensajes del cliente API", () => {
  it("explica un fallo de conexión", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    );
    await expect(api("/projects")).rejects.toThrow(
      "Comprueba que esté iniciada",
    );
  });
  it("explica un timeout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new DOMException("Timeout", "TimeoutError")),
    );
    await expect(api("/projects")).rejects.toThrow("10 segundos");
  });
  it("explica una respuesta no JSON del proxy", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response("<html>Error</html>", { status: 502 })),
    );
    await expect(api("/projects")).rejects.toThrow("HTTP 502");
  });
  it("conserva cancelaciones y mensajes de validación", async () => {
    const controller = new AbortController();
    controller.abort();
    const aborted = new DOMException("Abort", "AbortError");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(aborted));
    await expect(api("/projects", { signal: controller.signal })).rejects.toBe(
      aborted,
    );
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ message: "Destino no autorizado" }, { status: 400 }),
        ),
    );
    await expect(api("/projects")).rejects.toThrow("Destino no autorizado");
  });
});
