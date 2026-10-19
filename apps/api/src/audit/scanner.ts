import type { Page } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import {
  normalizeLocalUrl,
  SeveritySchema,
  type Finding,
} from "@accesoqa/shared";
import { withAuditPage } from "./browser.js";

export interface ScanResult {
  url: string;
  title: string;
  findings: Omit<
    Finding,
    "id" | "createdAt" | "url" | "pageTitle" | "stepPosition" | "stepLabel"
  >[];
  manualReviewCount: number;
  engineVersion: string;
}
export async function analyzePage(page: Page): Promise<ScanResult> {
  const url = normalizeLocalUrl(page.url());
  const title = await page.title();
  const result = await new AxeBuilder({ page }).analyze();
  if (page.url() !== url)
    throw new Error(
      "La página cambió de URL durante el análisis. Vuelve a intentarlo.",
    );
  return {
    url,
    title,
    manualReviewCount: result.incomplete.length,
    engineVersion: result.testEngine.version,
    findings: result.violations.map((violation) => ({
      ruleId: violation.id,
      impact: SeveritySchema.parse(violation.impact),
      description: violation.description,
      help: violation.help,
      helpUrl: violation.helpUrl,
      nodes: violation.nodes.map((node) => ({
        html: node.html,
        selector: JSON.stringify(node.target),
        failureSummary: node.failureSummary ?? null,
      })),
    })),
  };
}
export async function scanPage(input: string): Promise<ScanResult> {
  const url = normalizeLocalUrl(input);
  return withAuditPage(45000, async (page, assertAllowed) => {
    const response = await page.goto(url, {
      waitUntil: "networkidle",
      timeout: 15000,
    });
    assertAllowed();
    if (!response || response.status() >= 400)
      throw new Error(
        `La página local no respondió correctamente (HTTP ${response?.status() ?? "sin respuesta"}).`,
      );
    const result = await analyzePage(page);
    assertAllowed();
    return result;
  });
}
