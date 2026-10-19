import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  FolderKanban,
  Menu,
  Plus,
  ScanSearch,
  ShieldCheck,
} from "lucide-react";
import {
  AuditRunSchema,
  ProjectSchema,
  type AuditRun,
  type Project,
  type Severity,
} from "@accesoqa/shared";
import { api } from "./api";
import FlowPanel from "./FlowPanel";
import HistoryPanel from "./HistoryPanel";

const statusLabels = {
  queued: "Pendiente",
  running: "Ejecutándose",
  completed: "Completada",
  failed: "Fallida",
};
const impactLabels = {
  critical: "Crítico",
  serious: "Grave",
  moderate: "Moderado",
  minor: "Menor",
};
function errorText(error: unknown) {
  return error instanceof Error
    ? error.message
    : "No se pudo conectar con la API local.";
}

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [run, setRun] = useState<AuditRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [latestLoading, setLatestLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [impact, setImpact] = useState<Severity | "all">("all");
  const menuButton = useRef<HTMLButtonElement>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [flowBusy, setFlowBusy] = useState(false);
  const selected = projects.find((project) => project.id === selectedId);
  const busy = run?.status === "queued" || run?.status === "running";

  useEffect(() => {
    const controller = new AbortController();
    api("/projects", { signal: controller.signal })
      .then((payload) => {
        const items = ProjectSchema.array().parse(payload);
        setProjects(items);
        setSelectedId(items[0]?.id ?? "");
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(errorText(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    setRun(null);
    setImpact("all");
    if (!selectedId) return;
    const controller = new AbortController();
    setLatestLoading(true);
    api(`/projects/${selectedId}/audits/latest`, { signal: controller.signal })
      .then((payload) =>
        setRun(payload === null ? null : AuditRunSchema.parse(payload)),
      )
      .catch((cause) => {
        if (!controller.signal.aborted) setError(errorText(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLatestLoading(false);
      });
    return () => controller.abort();
  }, [selectedId]);

  useEffect(() => {
    if (!run || !["queued", "running"].includes(run.status)) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = AuditRunSchema.parse(
          await api(`/audits/${run.id}`, { signal: controller.signal }),
        );
        if (controller.signal.aborted) return;
        setRun(next);
        setError((previous) =>
          previous.startsWith("No se pudo actualizar el estado:")
            ? ""
            : previous,
        );
        if (["queued", "running"].includes(next.status))
          timer = setTimeout(() => {
            void poll();
          }, 800);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(`No se pudo actualizar el estado: ${errorText(cause)}`);
          timer = setTimeout(() => {
            void poll();
          }, 2000);
        }
      }
    };
    timer = setTimeout(() => {
      void poll();
    }, 400);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [run?.id, run?.status, selectedId]);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileOpen(false);
        menuButton.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mobileOpen]);
  useEffect(() => {
    if (run && ["completed", "failed"].includes(run.status))
      window.dispatchEvent(new Event("accesoqa:audit-finished"));
  }, [run?.id, run?.status]);
  async function createProject(event: FormEvent) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const project = ProjectSchema.parse(
        await api("/projects", {
          method: "POST",
          body: JSON.stringify({ name, baseUrl }),
        }),
      );
      setProjects((previous) => [project, ...previous]);
      setSelectedId(project.id);
      setName("");
      setBaseUrl("");
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setSubmitting(false);
    }
  }
  async function startAudit() {
    if (!selected) return;
    setStarting(true);
    setError("");
    setImpact("all");
    try {
      setRun(
        AuditRunSchema.parse(
          await api(`/projects/${selected.id}/audits`, {
            method: "POST",
            body: "{}",
          }),
        ),
      );
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setStarting(false);
    }
  }
  const findings =
    run?.findings.filter(
      (finding) => impact === "all" || finding.impact === impact,
    ) ?? [];

  return (
    <div className="app-shell">
      <a className="skip-link" href="#contenido">
        Saltar al contenido
      </a>
      <aside
        className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}
        aria-label="Navegación"
      >
        <a className="brand" href="#contenido">
          <span className="brand-mark">
            <ScanSearch size={19} />
          </span>
          <span>
            acceso<span className="brand-light">qa</span>
            <small>AUDITORÍA LOCAL</small>
          </span>
        </a>
        <div className="workspace">
          <span className="workspace-icon">A</span>
          <span>
            <strong>Área personal</strong>
            <small>Espacio local · MVP</small>
          </span>
        </div>
        <nav aria-label="Secciones">
          <a
            className="nav-item active"
            href="#proyectos"
            onClick={() => setMobileOpen(false)}
          >
            <FolderKanban size={17} />
            Proyectos <span className="nav-count">{projects.length}</span>
          </a>
          <a
            className="nav-item"
            href="#auditoria"
            onClick={() => setMobileOpen(false)}
          >
            <ScanSearch size={17} />
            Auditoría de página
          </a>
          <a
            className="nav-item"
            href="#flujos"
            onClick={() => setMobileOpen(false)}
          >
            <ScanSearch size={17} />
            Flujos de usuario
          </a>
          {selected && (
            <a
              className="nav-item"
              href="#historial"
              onClick={() => setMobileOpen(false)}
            >
              Historial e informes
            </a>
          )}
        </nav>
        <div className="sidebar-spacer" />
        <div className="sidebar-card">
          <ShieldCheck size={20} />
          <p>Chromium, axe-core y SQLite se ejecutan en tu equipo.</p>
          <span className="local-pill">
            <span /> Solo destinos locales
          </span>
        </div>
      </aside>
      {mobileOpen && (
        <button
          className="mobile-scrim"
          aria-label="Cerrar navegación"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <main className="main-area" id="contenido">
        <header className="topbar">
          <button
            ref={menuButton}
            className="mobile-menu"
            aria-label="Abrir navegación"
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen(!mobileOpen)}
          >
            <Menu size={20} />
          </button>
          <div className="breadcrumbs">
            Espacio de trabajo / <strong>Auditorías locales</strong>
          </div>
          <span className="local-status">
            <span /> Solo en este equipo
          </span>
        </header>
        <div className="page-content audit-workspace">
          <div className="welcome-row">
            <div>
              <div className="eyebrow">PLAYWRIGHT + AXE-CORE</div>
              <h1>Accesibilidad, con evidencia.</h1>
              <p className="intro">
                Registra una aplicación local y analiza una página con Chromium.
              </p>
            </div>
          </div>
          {error && (
            <div className="error-message" role="alert">
              {error}
              <button type="button" onClick={() => setError("")}>
                Cerrar mensaje
              </button>
            </div>
          )}
          <section
            className="panel"
            id="proyectos"
            aria-labelledby="projects-title"
          >
            <h2 id="projects-title">Registrar proyecto</h2>
            <form
              className="project-form"
              onSubmit={(event) => {
                void createProject(event);
              }}
            >
              <div className="form-field">
                <label htmlFor="project-name">Nombre del proyecto</label>
                <input
                  id="project-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                  maxLength={120}
                  placeholder="Mi aplicación local"
                />
              </div>
              <div className="form-field">
                <label htmlFor="project-url">URL de la página autorizada</label>
                <input
                  id="project-url"
                  type="url"
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                  required
                  maxLength={2048}
                  aria-describedby="url-help"
                  placeholder="http://127.0.0.1:4312/?modo=problemas"
                />
              </div>
              <button
                className="primary-button"
                disabled={submitting || loading || flowBusy || busy}
              >
                <Plus size={16} />
                {submitting ? "Guardando…" : "Registrar proyecto"}
              </button>
            </form>
            <p id="url-help" className="field-help">
              Solo HTTP/HTTPS con localhost, 127.0.0.1 o [::1]. Usa una
              aplicación que tengas autorización para analizar.
            </p>
          </section>
          <section
            className="panel"
            id="auditoria"
            aria-labelledby="audit-title"
          >
            <div className="audit-heading">
              <div>
                <h2 id="audit-title">Auditoría de una página</h2>
                <p className="field-help">
                  Se muestra la última ejecución del proyecto seleccionado.
                </p>
              </div>
              {run && (
                <span
                  className={`run-status status-${run.status}`}
                  role="status"
                >
                  {statusLabels[run.status]}
                </span>
              )}
            </div>
            {loading ? (
              <p role="status">Cargando proyectos…</p>
            ) : projects.length === 0 ? (
              <div className="empty-state">
                <FolderKanban size={28} />
                <h3>Aún no hay proyectos</h3>
                <p>
                  Registra tu primera aplicación para ejecutar una auditoría
                  real.
                </p>
              </div>
            ) : (
              <>
                <div className="audit-toolbar">
                  <div className="form-field">
                    <label htmlFor="selected-project">Proyecto</label>
                    <select
                      id="selected-project"
                      value={selectedId}
                      disabled={starting || flowBusy}
                      onChange={(event) => {
                        setError("");
                        setSelectedId(event.target.value);
                      }}
                    >
                      {projects.map((project) => (
                        <option key={project.id} value={project.id}>
                          {project.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    className="primary-button"
                    onClick={() => {
                      void startAudit();
                    }}
                    disabled={busy || starting || latestLoading || flowBusy}
                  >
                    <ScanSearch size={16} />
                    {starting
                      ? "Solicitando…"
                      : busy
                        ? "Auditoría en curso…"
                        : "Ejecutar auditoría"}
                  </button>
                </div>
                <p className="project-url">{selected?.baseUrl}</p>
                {latestLoading ? (
                  <p role="status">Cargando última ejecución…</p>
                ) : !run ? (
                  <div className="empty-state">
                    <ScanSearch size={28} />
                    <h3>Este proyecto aún no tiene auditorías</h3>
                    <p>
                      Ejecuta el análisis para obtener hallazgos reales de
                      axe-core.
                    </p>
                  </div>
                ) : (
                  <>
                    {busy && (
                      <div className="phase-banner" role="status">
                        {run.status === "queued"
                          ? "La auditoría está pendiente de iniciar."
                          : "Chromium está analizando la página. El proceso puede tardar hasta 45 segundos."}
                      </div>
                    )}
                    {run.status === "failed" && (
                      <div className="error-message" role="alert">
                        <strong>La auditoría falló.</strong>
                        <p>{run.errorMessage}</p>
                        <p>
                          No se generó un resultado válido. Este fallo no
                          significa que la página esté libre de problemas.
                        </p>
                      </div>
                    )}
                    <dl className="run-metadata">
                      <div>
                        <dt>Solicitada</dt>
                        <dd>
                          {new Date(run.createdAt).toLocaleString("es-PE")}
                        </dd>
                      </div>
                      <div>
                        <dt>Finalizada</dt>
                        <dd>
                          {run.finishedAt
                            ? new Date(run.finishedAt).toLocaleString("es-PE")
                            : "—"}
                        </dd>
                      </div>
                      {run.pageTitle && (
                        <div>
                          <dt>Página</dt>
                          <dd>{run.pageTitle}</dd>
                        </div>
                      )}
                      {run.url && (
                        <div>
                          <dt>URL auditada</dt>
                          <dd>{run.url}</dd>
                        </div>
                      )}
                    </dl>
                    {run.status === "completed" && (
                      <>
                        <div className="audit-summary">
                          <strong>
                            {run.findingsCount} reglas con incidencias
                            automáticas
                          </strong>
                          <span>
                            axe-core {run.engineVersion} ·{" "}
                            {run.findings.reduce(
                              (count, finding) => count + finding.nodes.length,
                              0,
                            )}{" "}
                            elementos afectados
                          </span>
                        </div>
                        <p className="manual-notice">
                          {run.manualReviewCount} comprobaciones requieren
                          revisión manual adicional de axe-core. La ausencia de
                          incidencias automáticas no demuestra cumplimiento
                          WCAG; también hacen falta pruebas manuales.
                        </p>
                        <div className="filter-row">
                          <label htmlFor="impact-filter">
                            Filtrar por impacto
                          </label>
                          <select
                            id="impact-filter"
                            value={impact}
                            onChange={(event) =>
                              setImpact(event.target.value as Severity | "all")
                            }
                          >
                            <option value="all">Todos los impactos</option>
                            {Object.entries(impactLabels).map(
                              ([value, label]) => (
                                <option key={value} value={value}>
                                  {label} ({value})
                                </option>
                              ),
                            )}
                          </select>
                          <span aria-live="polite">
                            {findings.length} de {run.findings.length} reglas
                          </span>
                        </div>
                        {findings.length === 0 ? (
                          <p className="empty-result">
                            {run.findings.length
                              ? "No hay incidencias con el impacto seleccionado."
                              : "Axe-core no detectó incidencias automáticas en esta ejecución."}
                          </p>
                        ) : (
                          <div
                            className="table-scroll"
                            role="region"
                            aria-label="Incidencias: tabla con desplazamiento horizontal"
                            tabIndex={0}
                          >
                            <table className="findings-table">
                              <caption>
                                Incidencias automáticas detectadas en la página
                              </caption>
                              <thead>
                                <tr>
                                  <th scope="col">Regla</th>
                                  <th scope="col">Impacto</th>
                                  <th scope="col">Descripción y elementos</th>
                                </tr>
                              </thead>
                              <tbody>
                                {findings.map((finding) => (
                                  <tr key={finding.id}>
                                    <th scope="row">{finding.ruleId}</th>
                                    <td>
                                      <span
                                        className={`impact impact-${finding.impact}`}
                                      >
                                        {impactLabels[finding.impact]}
                                        <small>{finding.impact}</small>
                                      </span>
                                    </td>
                                    <td>
                                      <strong>{finding.help}</strong>
                                      <p>{finding.description}</p>
                                      <details>
                                        <summary>
                                          Ver {finding.nodes.length} elemento(s)
                                          y referencia
                                        </summary>
                                        <p>
                                          <a
                                            href={finding.helpUrl}
                                            target="_blank"
                                            rel="noreferrer"
                                          >
                                            Referencia técnica de{" "}
                                            {finding.ruleId} (sitio externo)
                                          </a>
                                        </p>
                                        <p>
                                          Detectado:{" "}
                                          {new Date(
                                            finding.createdAt,
                                          ).toLocaleString("es-PE")}
                                        </p>
                                        {finding.nodes.map((node, index) => (
                                          <div
                                            className="finding-node"
                                            key={index}
                                          >
                                            <p>
                                              <strong>
                                                Selector / referencia
                                              </strong>
                                            </p>
                                            <pre>{node.selector}</pre>
                                            <p>
                                              <strong>HTML afectado</strong>
                                            </p>
                                            <pre>{node.html}</pre>
                                            {node.failureSummary && (
                                              <p className="failure-summary">
                                                {node.failureSummary}
                                              </p>
                                            )}
                                          </div>
                                        ))}
                                      </details>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </>
                    )}
                  </>
                )}
              </>
            )}
          </section>
          {selected && (
            <FlowPanel
              key={selected.id}
              project={selected}
              externalBusy={busy || starting}
              onBusyChange={setFlowBusy}
            />
          )}
          {selected && (
            <HistoryPanel
              key={`history-${selected.id}`}
              projectId={selected.id}
            />
          )}
          <footer className="footer">
            <span>AccesoQA · Auditoría automática local</span>
            <span>Sin puntuaciones estimadas</span>
          </footer>
        </div>
      </main>
    </div>
  );
}
