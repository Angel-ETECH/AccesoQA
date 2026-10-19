import { chromium, type Browser, type Page } from "playwright";
import { normalizeLocalUrl } from "@accesoqa/shared";
import { createLoopbackProxy } from "./proxy.js";

export async function withAuditPage<T>(
  durationMs: number,
  work: (page: Page, assertAllowed: () => void) => Promise<T>,
): Promise<T> {
  let blocked: string | null = null;
  const proxy = await createLoopbackProxy((message) => {
    blocked = message;
  });
  let browser: Browser | undefined;
  let launching: Promise<Browser> | undefined;
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new Error(
              `La auditoría superó el límite de ${durationMs / 1000} segundos.`,
            ),
          ),
        durationMs,
      );
    });
    const task = async () => {
      launching = chromium.launch({
        headless: true,
        timeout: 10000,
        proxy: { server: proxy.url, bypass: "<-loopback>" },
        args: [
          "--disable-background-networking",
          "--disable-quic",
          "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
        ],
      });
      browser = await launching;
      if (cancelled) throw new Error("La auditoría ya finalizó.");
      const context = await browser.newContext({
        serviceWorkers: "block",
        acceptDownloads: false,
        viewport: { width: 1365, height: 900 },
        locale: "es-ES",
      });
      await context.route("**/*", async (route) => {
        try {
          normalizeLocalUrl(route.request().url());
          await route.continue();
        } catch {
          blocked =
            "Se bloqueó una solicitud o redirección a un destino no autorizado.";
          await route.abort("blockedbyclient").catch(() => {});
        }
      });
      await context.routeWebSocket("**/*", (socket) => {
        try {
          normalizeLocalUrl(
            socket.url().replace(/^ws:/, "http:").replace(/^wss:/, "https:"),
          );
        } catch {
          blocked =
            "Se bloqueó una conexión WebSocket a un destino no autorizado.";
        }
        socket.close();
      });
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      page.setDefaultNavigationTimeout(15000);
      const assertAllowed = () => {
        if (cancelled) throw new Error("La auditoría se interrumpió.");
        if (blocked) throw new Error(blocked);
        normalizeLocalUrl(page.url());
      };
      const result = await work(page, assertAllowed);
      assertAllowed();
      return result;
    };
    return await Promise.race([task(), timeout]);
  } catch (error) {
    if (blocked && error instanceof Error && /^Paso \d/.test(error.message))
      throw error;
    if (blocked) throw new Error(blocked, { cause: error });
    if (
      error instanceof Error &&
      /Executable doesn't exist/.test(error.message)
    )
      throw new Error(
        "Chromium no está instalado. Ejecuta: npx playwright install chromium",
        { cause: error },
      );
    if (
      error instanceof Error &&
      /Target (page|context|browser)|browser has been closed|crashed|Failed to launch/i.test(
        error.message,
      )
    )
      throw new Error(
        "Chromium no pudo iniciar o se cerró durante la auditoría. Cierra otras instancias, comprueba la instalación y vuelve a intentarlo.",
        { cause: error },
      );
    throw error;
  } finally {
    cancelled = true;
    if (timer) clearTimeout(timer);
    try {
      const activeBrowser =
        browser ?? (await launching?.catch(() => undefined));
      await activeBrowser?.close();
    } finally {
      await proxy.close();
    }
  }
}
