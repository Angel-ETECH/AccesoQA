import type { Page } from "playwright";
import {
  MAX_FLOW_DURATION_MS,
  normalizeLocalUrl,
  TestDataTemplates,
  type FlowLocator,
  type FlowStep,
} from "@accesoqa/shared";
import { withAuditPage } from "./browser.js";
import { analyzePage, type ScanResult } from "./scanner.js";

function locate(page: Page, locator: FlowLocator) {
  if (locator.by === "role")
    return page.getByRole(locator.role, { name: locator.name, exact: true });
  if (locator.by === "label")
    return page.getByLabel(locator.value, { exact: true });
  return page.getByTestId(locator.value);
}
async function bounded<T>(
  work: () => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                `Timeout: el paso superó ${timeoutMs / 1000} segundos.`,
              ),
            ),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
export interface FlowObserver {
  start(position: number): void;
  complete(position: number, result: ScanResult | null): void;
}

export async function executeFlow(
  baseUrl: string,
  steps: FlowStep[],
  observer: FlowObserver,
) {
  const origin = new URL(normalizeLocalUrl(baseUrl)).origin;
  return withAuditPage(MAX_FLOW_DURATION_MS, async (page, assertAllowed) => {
    let manualReviewCount = 0;
    let engineVersion: string | null = null;
    for (const step of steps) {
      observer.start(step.position);
      try {
        const checkpoint = await bounded(async () => {
          const definition = step.definition;
          if (definition.action === "navigate") {
            const url = normalizeLocalUrl(
              new URL(definition.path, origin).href,
            );
            if (new URL(url).origin !== origin)
              throw new Error("La ruta debe pertenecer al proyecto.");
            const response = await page.goto(url, {
              waitUntil: "networkidle",
              timeout: definition.timeoutMs,
            });
            if (!response || response.status() >= 400)
              throw new Error(
                `La página local no respondió correctamente (HTTP ${response?.status() ?? "sin respuesta"}).`,
              );
          } else {
            const locator = locate(page, definition.locator);
            if (definition.action === "click")
              await locator.click({ timeout: definition.timeoutMs });
            else if (definition.action === "fill")
              await locator.fill(TestDataTemplates[definition.template], {
                timeout: definition.timeoutMs,
              });
            else
              await locator.waitFor({
                state: "visible",
                timeout: definition.timeoutMs,
              });
          }
          assertAllowed();
          if (new URL(page.url()).origin !== origin)
            throw new Error("El paso salió del origen del proyecto.");
          const result = definition.checkpoint ? await analyzePage(page) : null;
          assertAllowed();
          return result;
        }, step.definition.timeoutMs);
        observer.complete(step.position, checkpoint);
        if (checkpoint) {
          manualReviewCount += checkpoint.manualReviewCount;
          engineVersion = checkpoint.engineVersion;
        }
      } catch (error) {
        const detail =
          error instanceof Error && /Timeout|timeout/.test(error.message)
            ? "Timeout: no se completó la acción o el punto de control dentro del tiempo permitido."
            : error instanceof Error
              ? error.message
              : "Error desconocido.";
        const locator =
          step.definition.action === "navigate"
            ? step.definition.path
            : JSON.stringify(step.definition.locator);
        throw new Error(
          `Paso ${step.position} (${step.definition.label}): ${detail} Referencia: ${locator}`,
          { cause: error },
        );
      }
    }
    return { manualReviewCount, engineVersion };
  });
}
