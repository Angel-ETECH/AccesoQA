import { useEffect, useRef, useState } from "react";
import {
  AuditReportSchema,
  ComparisonSchema,
  HistorySchema,
} from "@accesoqa/shared";
import type { z } from "zod";
import { api } from "./api";
import "./history.css";
type History = z.infer<typeof HistorySchema>;
type Report = z.infer<typeof AuditReportSchema>;
type Comparison = z.infer<typeof ComparisonSchema>;
const statusLabels = {
  queued: "Pendiente",
  running: "Ejecutándose",
  completed: "Completada",
  failed: "Fallida",
  pending: "Pendiente",
  skipped: "No ejecutado",
};
const labels = {
  new: "Nueva",
  persistent: "Persistente",
  potentiallyFixed: "Potencialmente corregida",
  notCompared: "Sin comparar",
};
export default function HistoryPanel({ projectId }: { projectId: string }) {
  const activeRequest = useRef<AbortController | null>(null);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [selectedBase, setSelectedBase] = useState<
    History["items"][number] | null
  >(null);
  const [history, setHistory] = useState<History | null>(null),
    [offset, setOffset] = useState(0),
    [revision, setRevision] = useState(0),
    [detail, setDetail] = useState<Report | null>(null),
    [comparison, setComparison] = useState<Comparison | null>(null),
    [baseline, setBaseline] = useState(""),
    [current, setCurrent] = useState(""),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setHistoryLoading(true);
    api(`/projects/${projectId}/audits?limit=20&offset=${offset}`, {
      signal: controller.signal,
    })
      .then((data) => {
        if (active) {
          setHistory(HistorySchema.parse(data));
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(String(e));
      })
      .finally(() => {
        if (active) setHistoryLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [projectId, offset, revision]);
  useEffect(() => {
    const refresh = () => setRevision((r) => r + 1);
    window.addEventListener("accesoqa:audit-finished", refresh);
    return () => {
      window.removeEventListener("accesoqa:audit-finished", refresh);
      activeRequest.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (
      current &&
      history &&
      !history.items.some((item) => item.id === current)
    ) {
      setCurrent("");
      setComparison(null);
    }
  }, [history, current]);
  async function inspect(id: string) {
    setError("");
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setDetail(null);
    setLoading(true);
    try {
      setDetail(
        AuditReportSchema.parse(
          await api(`/audits/${id}/report`, { signal: controller.signal }),
        ),
      );
    } catch (e) {
      if (!controller.signal.aborted) setError(String(e));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }
  async function compareRuns() {
    setError("");
    setComparison(null);
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setLoading(true);
    try {
      const flow = selectedBase?.flowId;
      if (!flow) throw new Error("Selecciona ejecuciones de un flujo.");
      setComparison(
        ComparisonSchema.parse(
          await api(
            `/flows/${flow}/compare?baseline=${baseline}&current=${current}`,
            { signal: controller.signal },
          ),
        ),
      );
    } catch (e) {
      if (!controller.signal.aborted) setError(String(e));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }
  const base = selectedBase;
  return (
    <section
      className="panel history-panel"
      id="historial"
      aria-labelledby="history-title"
    >
      <h2 id="history-title">Historial y comparación</h2>
      <p>
        Selecciona una ejecución para consultar sus datos y descargar el
        informe. Los recuentos corresponden a elementos por punto de control.
      </p>
      <button type="button" onClick={() => setRevision((r) => r + 1)}>
        Actualizar historial
      </button>
      {error && <p role="alert">{error}</p>}
      {loading && <p role="status">Cargando informe…</p>}
      {historyLoading && <p role="status">Cargando historial…</p>}
      {!historyLoading && history?.total === 0 && (
        <p className="empty-result">
          Todavía no hay ejecuciones. Ejecuta una auditoría de página o un flujo
          para guardar el primer resultado.
        </p>
      )}
      <div className="history-list">
        {history?.items.map((item) => (
          <div key={item.id}>
            <button
              type="button"
              disabled={loading}
              onClick={() => void inspect(item.id)}
            >
              Ver ejecución {new Date(item.createdAt).toLocaleString("es-PE")} ·{" "}
              {item.id.slice(0, 8)}
            </button>
            <span>
              Estado: {statusLabels[item.status]} ·{" "}
              {item.flowId ? "Flujo" : "Página individual"}
            </span>
            {item.errorMessage && <p>{item.errorMessage}</p>}
          </div>
        ))}
      </div>
      {history && (
        <p>
          {history.total} ejecuciones · Página {Math.floor(offset / 20) + 1}{" "}
          <button
            disabled={offset === 0}
            onClick={() => setOffset((o) => Math.max(0, o - 20))}
          >
            Anterior
          </button>{" "}
          <button
            disabled={offset + 20 >= history.total}
            onClick={() => setOffset((o) => o + 20)}
          >
            Siguiente
          </button>
        </p>
      )}
      <div className="history-selectors">
        <label>
          Base de comparación
          <select
            disabled={loading}
            value={baseline}
            onChange={(e) => {
              setBaseline(e.target.value);
              setSelectedBase(
                history?.items.find((i) => i.id === e.target.value) ?? null,
              );
              setCurrent("");
              setComparison(null);
            }}
          >
            <option value="">Selecciona una ejecución de flujo</option>
            {selectedBase &&
              !history?.items.some((i) => i.id === selectedBase.id) && (
                <option value={selectedBase.id}>
                  {selectedBase.createdAt} · {selectedBase.id.slice(0, 8)}
                </option>
              )}
            {history?.items
              .filter((i) => i.flowId)
              .map((i) => (
                <option value={i.id} key={i.id}>
                  {i.createdAt} · {i.id.slice(0, 8)} · {statusLabels[i.status]}
                </option>
              ))}
          </select>
        </label>
        <label>
          Revisión posterior
          <select
            disabled={loading}
            value={current}
            onChange={(e) => {
              setCurrent(e.target.value);
              setComparison(null);
            }}
          >
            <option value="">Selecciona la revisión</option>
            {history?.items
              .filter(
                (i) =>
                  base &&
                  i.flowId === base.flowId &&
                  i.id !== baseline &&
                  i.createdAt >= base.createdAt,
              )
              .map((i) => (
                <option value={i.id} key={i.id}>
                  {i.createdAt} · {i.id.slice(0, 8)} · {i.status}
                </option>
              ))}
          </select>
        </label>
        <button
          disabled={!baseline || !current || loading}
          onClick={() => void compareRuns()}
        >
          Comparar ejecuciones
        </button>
      </div>
      {comparison && (
        <div aria-label="Resultado de comparación">
          <h3>
            Comparación:{" "}
            {comparison.coverage === "complete"
              ? "Completa"
              : comparison.coverage === "partial"
                ? "Parcial"
                : "No disponible"}
          </h3>
          <p>
            Nuevas: {comparison.counts.new} · Persistentes:{" "}
            {comparison.counts.persistent} · Potencialmente corregidas:{" "}
            {comparison.counts.potentiallyFixed} · Sin comparar:{" "}
            {comparison.counts.notCompared}
          </p>
          {comparison.reasons.map((r, i) => (
            <p key={i}>{r}</p>
          ))}
          {comparison.changes.map((c, i) => (
            <details key={i}>
              <summary>
                {labels[c.classification]} · {(c.after ?? c.before)!.ruleId} ·{" "}
                {(c.after ?? c.before)!.label} · {(c.after ?? c.before)!.impact}
              </summary>
              {c.before && (
                <div>
                  <strong>Antes</strong>
                  <pre>{c.before.html}</pre>
                  <pre>{c.before.selector}</pre>
                </div>
              )}
              {c.after && (
                <div>
                  <strong>Después</strong>
                  <pre>{c.after.html}</pre>
                  <pre>{c.after.selector}</pre>
                </div>
              )}
            </details>
          ))}
        </div>
      )}
      {detail && (
        <div aria-label="Informe histórico">
          <h3>Ejecución {detail.run.id}</h3>
          <p>
            Estado: {statusLabels[detail.run.status]} · Fecha:{" "}
            {detail.run.createdAt}
          </p>
          {detail.run.status !== "completed" && (
            <p role="status">
              Resultado parcial. Un fallo no significa ausencia de problemas.
            </p>
          )}
          <a href={`/api/audits/${detail.run.id}/export.json`} download>
            Exportar JSON
          </a>{" "}
          ·{" "}
          <a href={`/api/audits/${detail.run.id}/export.html`} download>
            Exportar HTML
          </a>
          <h4>Resumen por impacto</h4>
          <p>
            {Object.entries(detail.summary.byImpact)
              .map(([impact, count]) => `${impact}: ${count}`)
              .join(" · ")}
          </p>
          <h4>Resumen por paso</h4>
          {detail.summary.byStep.map((s) => (
            <p key={s.position}>
              {s.position}. {s.label}: {s.total} elementos ·{" "}
              {Object.entries(s.byImpact)
                .map(([k, v]) => `${k}: ${v}`)
                .join(" · ")}
            </p>
          ))}
          {detail.run.steps.map((s) => (
            <p key={s.id}>
              Paso {s.position}: {s.label} — {statusLabels[s.status]}{" "}
              {s.errorMessage}
            </p>
          ))}
          {detail.occurrences.map((i) => (
            <details key={i.stableId}>
              <summary>
                {i.ruleId} · {i.impact} · {i.label}
              </summary>
              <p>{i.description}</p>
              <p>{i.screen}</p>
              <pre>{i.html}</pre>
              <pre>{i.selector}</pre>
              <p>Referencia: {i.helpUrl}</p>
              <p>{i.stableId}</p>
            </details>
          ))}
        </div>
      )}
      <p>
        «Potencialmente corregida» requiere revisión humana. Solo se comparan
        puntos equivalentes y análisis completos; no se declara cumplimiento
        WCAG.
      </p>
    </section>
  );
}
