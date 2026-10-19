import { createHash } from "node:crypto";
import {
  AuditReportSchema,
  ComparisonSchema,
  type AuditRun,
  type Occurrence,
} from "@accesoqa/shared";
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
const hash = (value: unknown) =>
  createHash("sha256").update(canonical(value)).digest("hex");
export const CONFIG_KEY = hash({
  version: 1,
  axe: "default-all-rules",
  viewport: [1365, 900],
  locale: "es-ES",
});
export const limitations = [
  "La comparación solo cubre puntos equivalentes del mismo flujo, con URL exacta, secuencia previa, configuración y versión de axe iguales.",
  "Una ejecución fallida, un punto ausente o un análisis con revisiones manuales pendientes no permite inferir correcciones.",
  "Potencialmente corregida significa que el identificador ya no se observó; cambios de selector, DOM, datos o estado pueden alterar la identidad. Requiere revisión humana.",
  "No se calcula una puntuación ni se declara cumplimiento WCAG. Los resultados automáticos no sustituyen las pruebas manuales.",
  "Las ejecuciones anteriores a esta versión carecen de procedencia de configuración y se conservan sin comparación automática.",
];
export function checkpointKey(run: AuditRun, position: number, url: string) {
  const prefix = run.steps
    .filter((s) => s.position <= position)
    .map((s) => {
      const { label: _label, ...definition } = s.definition;
      void _label;
      return { position: s.position, definition };
    });
  return hash({
    version: 1,
    project: run.projectId,
    flow: run.flowId,
    prefix,
    screen: new URL(url).href,
  });
}
export function occurrences(run: AuditRun): Occurrence[] {
  const found = new Map<string, Occurrence>();
  for (const cp of run.checkpoints) {
    const key = checkpointKey(run, cp.position, cp.url);
    for (const finding of cp.findings)
      for (const node of finding.nodes) {
        let selector: unknown = node.selector;
        try {
          selector = JSON.parse(node.selector) as unknown;
        } catch {
          /* Preserve legacy selector text. */
        }
        const stableId = hash({
          version: 1,
          checkpoint: key,
          rule: finding.ruleId,
          selector,
        });
        if (!found.has(stableId))
          found.set(stableId, {
            stableId,
            checkpointKey: key,
            checkpointId: cp.id,
            position: cp.position,
            label: cp.label,
            screen: cp.url,
            ruleId: finding.ruleId,
            impact: finding.impact,
            description: finding.description,
            helpUrl: finding.helpUrl,
            html: node.html,
            selector: node.selector,
            failureSummary: node.failureSummary,
            observedAt: finding.createdAt,
          });
      }
  }
  return [...found.values()];
}
const emptyImpact = () => ({ critical: 0, serious: 0, moderate: 0, minor: 0 });
export function report(run: AuditRun) {
  const items = occurrences(run),
    byImpact = emptyImpact();
  for (const item of items) byImpact[item.impact]++;
  const byStep = run.checkpoints.map((cp) => {
    const subset = items.filter((i) => i.checkpointId === cp.id),
      counts = emptyImpact();
    for (const item of subset) counts[item.impact]++;
    return {
      position: cp.position,
      label: cp.label,
      total: subset.length,
      byImpact: counts,
    };
  });
  return AuditReportSchema.parse({
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    run,
    occurrences: items,
    summary: { total: items.length, byImpact, byStep },
    limitations,
  });
}
function complete(run: AuditRun) {
  if (run.status !== "completed" || !run.checkpoints.length) return false;
  if (!run.flowId) return true;
  return (
    run.steps.length > 0 &&
    run.steps.every((s) => s.status === "completed") &&
    run.steps
      .filter((s) => s.definition.checkpoint)
      .every(
        (s) =>
          run.checkpoints.filter((c) => c.position === s.position).length === 1,
      )
  );
}
export function compare(baseline: AuditRun, current: AuditRun) {
  if (
    !baseline.flowId ||
    baseline.flowId !== current.flowId ||
    baseline.projectId !== current.projectId ||
    baseline.id === current.id ||
    baseline.createdAt > current.createdAt
  )
    throw new Error(
      "Selecciona dos ejecuciones distintas del mismo flujo, en orden cronológico.",
    );
  const before = occurrences(baseline),
    after = occurrences(current),
    reasons: string[] = [],
    eligible = new Set<string>();
  if (!complete(baseline) || !complete(current))
    reasons.push(
      "Hay una ejecución fallida, pendiente o incompleta; no se infieren correcciones.",
    );
  else if (!baseline.configKey || baseline.configKey !== current.configKey)
    reasons.push("Configuración desconocida o diferente.");
  else {
    const keys = new Set([
      ...baseline.checkpoints.map((c) =>
        checkpointKey(baseline, c.position, c.url),
      ),
      ...current.checkpoints.map((c) =>
        checkpointKey(current, c.position, c.url),
      ),
    ]);
    for (const key of keys) {
      const a = baseline.checkpoints.filter(
          (c) => checkpointKey(baseline, c.position, c.url) === key,
        ),
        b = current.checkpoints.filter(
          (c) => checkpointKey(current, c.position, c.url) === key,
        );
      if (a.length !== 1 || b.length !== 1)
        reasons.push(
          "Punto de control sin equivalente único: " + key.slice(0, 12),
        );
      else if (
        !a[0]!.engineVersion ||
        a[0]!.engineVersion !== b[0]!.engineVersion ||
        a[0]!.manualReviewCount !== 0 ||
        b[0]!.manualReviewCount !== 0
      )
        reasons.push(
          "Punto con motor distinto/desconocido o análisis pendiente de revisión: " +
            a[0]!.label,
        );
      else eligible.add(key);
    }
  }
  type Change = {
    classification: "new" | "persistent" | "potentiallyFixed" | "notCompared";
    before: Occurrence | null;
    after: Occurrence | null;
  };
  const changes: Change[] = [],
    counts = { new: 0, persistent: 0, potentiallyFixed: 0, notCompared: 0 };
  const left = new Map(before.map((i) => [i.stableId, i])),
    right = new Map(after.map((i) => [i.stableId, i]));
  for (const id of new Set([...left.keys(), ...right.keys()])) {
    const a = left.get(id) ?? null,
      b = right.get(id) ?? null;
    const classification = !eligible.has((a ?? b)!.checkpointKey)
      ? "notCompared"
      : a && b
        ? "persistent"
        : a
          ? "potentiallyFixed"
          : "new";
    changes.push({ classification, before: a, after: b });
    counts[classification]++;
  }
  return ComparisonSchema.parse({
    baselineId: baseline.id,
    currentId: current.id,
    flowId: baseline.flowId,
    coverage:
      eligible.size === 0
        ? "unavailable"
        : reasons.length
          ? "partial"
          : "complete",
    reasons,
    counts,
    changes,
  });
}
const escape = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
export function htmlReport(run: AuditRun) {
  const data = report(run);
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><meta name="viewport" content="width=device-width"><title>Informe AccesoQA</title><style>body{font:16px system-ui;max-width:1000px;margin:32px auto;padding:20px;color:#17243b}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#eef2f7;padding:16px}article{border-top:1px solid #aaa;padding:16px 0}td,th{padding:8px;text-align:left}</style></head><body><h1>Informe AccesoQA</h1><p>Ejecución: ${escape(run.id)}</p><p>Fecha: ${escape(run.createdAt)} · Estado: ${escape(run.status)}</p><p>URL: ${escape(run.requestedUrl)}</p><p>Error: ${escape(run.errorMessage)}</p><p>Elementos observados: ${data.summary.total}. ${run.status !== "completed" ? "Resultado parcial: no indica ausencia de problemas." : ""}</p><h2>Resumen por impacto</h2><pre>${escape(JSON.stringify(data.summary.byImpact, null, 2))}</pre><h2>Pasos y puntos de control</h2>${run.steps.map((s) => `<p>${s.position}. ${escape(s.label)}: ${escape(s.status)} — ${escape(s.errorMessage)}</p>`).join("")}<pre>${escape(JSON.stringify(data.summary.byStep, null, 2))}</pre><h2>Incidencias</h2>${data.occurrences.map((i) => `<article><h3>${escape(i.ruleId)} · ${escape(i.impact)}</h3><p>${escape(i.label)} · ${escape(i.screen)}</p><p>${escape(i.description)}</p><p>Referencia: ${escape(i.helpUrl)}</p><p>Identificador: ${escape(i.stableId)}</p><pre>${escape(i.html)}</pre><pre>${escape(i.selector)}</pre><p>${escape(i.failureSummary)}</p></article>`).join("")}<h2>Limitaciones</h2><ul>${limitations.map((l) => `<li>${escape(l)}</li>`).join("")}</ul></body></html>`;
}
