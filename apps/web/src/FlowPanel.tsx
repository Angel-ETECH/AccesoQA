import { useEffect, useState, type FormEvent } from "react";
import {
  AccessibleRoles,
  AuditRunSchema,
  CreateFlowSchema,
  FlowSchema,
  FlowStepInputSchema,
  MAX_FLOW_STEPS,
  type AuditRun,
  type Flow,
  type FlowStepInput,
  type Project,
  type Severity,
} from "@accesoqa/shared";
import { api } from "./api";
import "./flows.css";

type Draft = {
  key: string;
  label: string;
  action: FlowStepInput["action"];
  path: string;
  by: "label" | "role" | "testId";
  value: string;
  role: (typeof AccessibleRoles)[number];
  template: "name" | "email" | "text" | "number" | "password";
  checkpoint: boolean;
  timeoutMs: number;
};
const actionLabels = {
  navigate: "Navegar a una ruta",
  click: "Hacer clic",
  fill: "Completar campo",
  visible: "Verificar visibilidad",
};
const stepStatus = {
  pending: "Pendiente",
  running: "Ejecutándose",
  completed: "Completado",
  failed: "Fallido",
  skipped: "No ejecutado",
};
const runStatus = {
  queued: "Pendiente",
  running: "Ejecutándose",
  completed: "Completada",
  failed: "Fallida",
};
const templateLabels = {
  name: "Nombre: Usuario de prueba",
  email: "Correo: usuario@example.test",
  text: "Texto: Dato ficticio",
  number: "Número: 12345",
  password: "Contraseña ficticia generada",
};
function draft(definition?: FlowStepInput): Draft {
  const base: Draft = {
    key: crypto.randomUUID(),
    label: "Abrir página",
    action: "navigate",
    path: "/",
    by: "label",
    value: "",
    role: "button",
    template: "text",
    checkpoint: false,
    timeoutMs: 10000,
  };
  if (!definition) return base;
  const result = {
    ...base,
    label: definition.label,
    action: definition.action,
    checkpoint: definition.checkpoint,
    timeoutMs: definition.timeoutMs,
  };
  if (definition.action === "navigate")
    return { ...result, path: definition.path };
  return {
    ...result,
    by: definition.locator.by,
    value:
      definition.locator.by === "role"
        ? definition.locator.name
        : definition.locator.value,
    role: definition.locator.by === "role" ? definition.locator.role : "button",
    template: definition.action === "fill" ? definition.template : "text",
  };
}
function definition(step: Draft): FlowStepInput {
  const common = {
    label: step.label,
    checkpoint: step.checkpoint,
    timeoutMs: step.timeoutMs,
  };
  const locator =
    step.by === "role"
      ? { by: "role", role: step.role, name: step.value }
      : { by: step.by, value: step.value };
  const result = FlowStepInputSchema.safeParse(
    step.action === "navigate"
      ? { ...common, action: step.action, path: step.path }
      : step.action === "fill"
        ? { ...common, action: step.action, locator, template: step.template }
        : { ...common, action: step.action, locator },
  );
  if (!result.success)
    throw new Error(
      result.error.issues.map((issue) => issue.message).join(" "),
    );
  return result.data;
}
function message(error: unknown) {
  return error instanceof Error
    ? error.message
    : "No se pudo completar la operación.";
}

export default function FlowPanel({
  project,
  externalBusy,
  onBusyChange,
}: {
  project: Project;
  externalBusy: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const [flows, setFlows] = useState<Flow[]>([]);
  const [selected, setSelected] = useState("");
  const [run, setRun] = useState<AuditRun | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [latestLoading, setLatestLoading] = useState(false);
  const [posting, setPosting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [name, setName] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [steps, setSteps] = useState<Draft[]>([draft()]);
  const [impact, setImpact] = useState<Severity | "all">("all");
  const busy = run?.status === "queued" || run?.status === "running";
  useEffect(() => {
    if (run && ["completed", "failed"].includes(run.status))
      window.dispatchEvent(new Event("accesoqa:audit-finished"));
  }, [run?.id, run?.status]);
  useEffect(() => {
    onBusyChange(busy);
    return () => onBusyChange(false);
  }, [busy, onBusyChange]);
  useEffect(() => {
    const controller = new AbortController();
    api(`/projects/${project.id}/flows`, { signal: controller.signal })
      .then((payload) => {
        const items = FlowSchema.array().parse(payload);
        setFlows(items);
        setSelected(items[0]?.id ?? "");
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(message(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [project.id]);
  useEffect(() => {
    setRun(null);
    setImpact("all");
    if (!selected) return;
    const controller = new AbortController();
    setLatestLoading(true);
    api(`/flows/${selected}/audits/latest`, { signal: controller.signal })
      .then((payload) =>
        setRun(payload === null ? null : AuditRunSchema.parse(payload)),
      )
      .catch((cause) => {
        if (!controller.signal.aborted) setError(message(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLatestLoading(false);
      });
    return () => controller.abort();
  }, [selected]);
  useEffect(() => {
    if (!run || !busy) return;
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
          previous.startsWith("No se pudo actualizar la ejecución:")
            ? ""
            : previous,
        );
        if (["queued", "running"].includes(next.status))
          timer = setTimeout(() => {
            void poll();
          }, 700);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(`No se pudo actualizar la ejecución: ${message(cause)}`);
          timer = setTimeout(() => {
            void poll();
          }, 2000);
        }
      }
    };
    timer = setTimeout(() => {
      void poll();
    }, 300);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [run?.id, busy, selected]);
  function change(index: number, values: Partial<Draft>) {
    setSteps((previous) =>
      previous.map((item, position) =>
        position === index ? { ...item, ...values } : item,
      ),
    );
  }
  function move(index: number, direction: number) {
    setSteps((previous) => {
      const next = [...previous];
      const other = index + direction;
      if (!next[index] || !next[other]) return previous;
      [next[index], next[other]] = [next[other]!, next[index]!];
      return next;
    });
  }
  function edit(flow?: Flow) {
    setError("");
    setEditingId(flow?.id ?? "");
    setName(flow?.name ?? "");
    setConfirmed(false);
    const url = new URL(project.baseUrl);
    setSteps(
      flow
        ? flow.steps.map((step) => draft(step.definition))
        : [
            draft({
              label: "Abrir página",
              action: "navigate",
              path: url.pathname + url.search,
              checkpoint: true,
              timeoutMs: 15000,
            }),
          ],
    );
    setEditing(true);
  }
  function example() {
    setName("Registro de usuario");
    setConfirmed(false);
    setSteps([
      draft({
        label: "Abrir registro",
        action: "navigate",
        path: "/registro?modo=corregido",
        checkpoint: true,
        timeoutMs: 15000,
      }),
      draft({
        label: "Completar nombre ficticio",
        action: "fill",
        locator: { by: "label", value: "Nombre completo" },
        template: "name",
        checkpoint: false,
        timeoutMs: 5000,
      }),
      draft({
        label: "Completar correo ficticio",
        action: "fill",
        locator: { by: "label", value: "Correo electrónico" },
        template: "email",
        checkpoint: false,
        timeoutMs: 5000,
      }),
      draft({
        label: "Crear cuenta de prueba",
        action: "click",
        locator: { by: "role", role: "button", name: "Crear cuenta" },
        checkpoint: false,
        timeoutMs: 5000,
      }),
      draft({
        label: "Evaluar confirmación",
        action: "visible",
        locator: { by: "testId", value: "registration-success" },
        checkpoint: true,
        timeoutMs: 15000,
      }),
    ]);
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const input = CreateFlowSchema.safeParse({
        name,
        testDataOnly: confirmed,
        steps: steps.map(definition),
      });
      if (!input.success)
        throw new Error(
          input.error.issues.map((issue) => issue.message).join(" "),
        );
      if (
        editingId &&
        !window.confirm(
          "¿Reemplazar la definición de este flujo? Las ejecuciones anteriores conservarán sus pasos originales.",
        )
      )
        return;
      setPosting(true);
      const flow = FlowSchema.parse(
        await api(
          editingId ? `/flows/${editingId}` : `/projects/${project.id}/flows`,
          {
            method: editingId ? "PUT" : "POST",
            body: JSON.stringify(input.data),
          },
        ),
      );
      setFlows((previous) => [
        flow,
        ...previous.filter((item) => item.id !== flow.id),
      ]);
      setSelected(flow.id);
      setEditing(false);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setPosting(false);
    }
  }
  async function execute() {
    setError("");
    setPosting(true);
    setImpact("all");
    try {
      setRun(
        AuditRunSchema.parse(
          await api(`/flows/${selected}/audits`, {
            method: "POST",
            body: "{}",
          }),
        ),
      );
    } catch (cause) {
      setError(message(cause));
    } finally {
      setPosting(false);
    }
  }
  const selectedFlow = flows.find((flow) => flow.id === selected);
  const ruleIds = [
    ...new Set(
      run?.checkpoints.flatMap((checkpoint) =>
        checkpoint.findings.map((finding) => finding.ruleId),
      ) ?? [],
    ),
  ];
  return (
    <section
      id="flujos"
      className="panel flow-panel"
      aria-labelledby="flow-title"
    >
      <div className="audit-heading">
        <div>
          <h2 id="flow-title">Flujos de usuario</h2>
          <p className="field-help">
            Proyecto: {project.name} · Hasta 20 pasos, 15 segundos por paso y
            120 segundos por flujo.
          </p>
        </div>
        <button
          className="secondary-button"
          onClick={() => edit()}
          disabled={busy || externalBusy || posting}
        >
          Nuevo flujo
        </button>
      </div>
      {error && (
        <div className="error-message" role="alert">
          {error}
          <button type="button" onClick={() => setError("")}>
            Cerrar mensaje del flujo
          </button>
        </div>
      )}
      {loading ? (
        <p role="status">Cargando flujos…</p>
      ) : flows.length === 0 && !editing ? (
        <p className="empty-result">
          Todavía no hay flujos en este proyecto. Crea uno o carga el ejemplo de
          registro de la fixture.
        </p>
      ) : null}
      {editing && (
        <form
          onSubmit={(event) => {
            void save(event);
          }}
          className="flow-editor"
          aria-label="Editor de flujo"
        >
          <div className="form-field">
            <label htmlFor="flow-name">Nombre del flujo</label>
            <input
              id="flow-name"
              required
              maxLength={120}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="flow-editor-tools">
            <button
              type="button"
              className="secondary-button"
              onClick={example}
            >
              Cargar ejemplo de registro
            </button>
            <p className="field-help">
              El ejemplo usa /registro de la fixture local. Adapta la ruta si tu
              proyecto es otro.
            </p>
          </div>
          {steps.map((step, index) => (
            <fieldset className="step-editor" key={step.key}>
              <legend>Paso {index + 1}</legend>
              <div className="step-editor-grid">
                <div className="form-field">
                  <label htmlFor={`label-${step.key}`}>Nombre del paso</label>
                  <input
                    id={`label-${step.key}`}
                    required
                    maxLength={120}
                    value={step.label}
                    onChange={(event) =>
                      change(index, { label: event.target.value })
                    }
                  />
                </div>
                <div className="form-field">
                  <label htmlFor={`action-${step.key}`}>Acción</label>
                  <select
                    id={`action-${step.key}`}
                    value={step.action}
                    onChange={(event) =>
                      change(index, {
                        action: event.target.value as Draft["action"],
                      })
                    }
                  >
                    {Object.entries(actionLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                {step.action === "navigate" ? (
                  <div className="form-field">
                    <label htmlFor={`path-${step.key}`}>Ruta local</label>
                    <input
                      id={`path-${step.key}`}
                      required
                      value={step.path}
                      onChange={(event) =>
                        change(index, { path: event.target.value })
                      }
                      placeholder="/registro"
                    />
                  </div>
                ) : (
                  <>
                    <div className="form-field">
                      <label htmlFor={`by-${step.key}`}>Localizador</label>
                      <select
                        id={`by-${step.key}`}
                        value={step.by}
                        onChange={(event) =>
                          change(index, {
                            by: event.target.value as Draft["by"],
                          })
                        }
                      >
                        <option value="label">Etiqueta accesible</option>
                        <option value="role">Rol y nombre accesible</option>
                        <option value="testId">data-testid</option>
                      </select>
                    </div>
                    {step.by === "role" && (
                      <div className="form-field">
                        <label htmlFor={`role-${step.key}`}>Rol</label>
                        <select
                          id={`role-${step.key}`}
                          value={step.role}
                          onChange={(event) =>
                            change(index, {
                              role: event.target.value as Draft["role"],
                            })
                          }
                        >
                          {AccessibleRoles.map((role) => (
                            <option key={role}>{role}</option>
                          ))}
                        </select>
                      </div>
                    )}
                    <div className="form-field">
                      <label htmlFor={`target-${step.key}`}>
                        {step.by === "testId"
                          ? "Identificador de prueba"
                          : step.by === "role"
                            ? "Nombre accesible"
                            : "Texto de la etiqueta"}
                      </label>
                      <input
                        id={`target-${step.key}`}
                        required
                        maxLength={160}
                        value={step.value}
                        onChange={(event) =>
                          change(index, { value: event.target.value })
                        }
                      />
                    </div>
                    {step.action === "fill" && (
                      <div className="form-field">
                        <label htmlFor={`data-${step.key}`}>
                          Dato ficticio
                        </label>
                        <select
                          id={`data-${step.key}`}
                          value={step.template}
                          onChange={(event) =>
                            change(index, {
                              template: event.target.value as Draft["template"],
                            })
                          }
                        >
                          {Object.entries(templateLabels).map(
                            ([value, label]) => (
                              <option key={value} value={value}>
                                {label}
                              </option>
                            ),
                          )}
                        </select>
                      </div>
                    )}
                  </>
                )}
                <div className="form-field">
                  <label htmlFor={`timeout-${step.key}`}>
                    Tiempo máximo (segundos)
                  </label>
                  <select
                    id={`timeout-${step.key}`}
                    value={step.timeoutMs}
                    onChange={(event) =>
                      change(index, { timeoutMs: Number(event.target.value) })
                    }
                  >
                    {[1000, 3000, 5000, 10000, 15000].map((value) => (
                      <option key={value} value={value}>
                        {value / 1000}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <label className="flow-check">
                <input
                  type="checkbox"
                  checked={step.checkpoint}
                  onChange={(event) =>
                    change(index, { checkpoint: event.target.checked })
                  }
                />
                Auditar accesibilidad después de este paso
              </label>
              <div className="step-controls">
                <button
                  type="button"
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                  aria-label={`Subir paso ${index + 1}`}
                >
                  Subir
                </button>
                <button
                  type="button"
                  disabled={index === steps.length - 1}
                  onClick={() => move(index, 1)}
                  aria-label={`Bajar paso ${index + 1}`}
                >
                  Bajar
                </button>
                <button
                  type="button"
                  disabled={steps.length === 1}
                  onClick={() => {
                    if (
                      window.confirm(
                        `¿Eliminar el paso ${index + 1}? Este cambio se aplicará al guardar el flujo.`,
                      )
                    )
                      setSteps((previous) =>
                        previous.filter((_, position) => position !== index),
                      );
                  }}
                  aria-label={`Eliminar paso ${index + 1}`}
                >
                  Eliminar
                </button>
              </div>
            </fieldset>
          ))}
          <button
            type="button"
            className="secondary-button"
            disabled={steps.length >= MAX_FLOW_STEPS}
            onClick={() =>
              setSteps((previous) => [
                ...previous,
                { ...draft(), label: "Nuevo paso", action: "click" },
              ])
            }
          >
            Agregar paso
          </button>
          <label className="flow-check">
            <input
              type="checkbox"
              required
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            Confirmo que usaré exclusivamente datos de prueba en una aplicación
            autorizada.
          </label>
          <p className="field-help">
            Los campos se rellenan con valores ficticios predefinidos. Los
            localizadores coinciden exactamente; un localizador ambiguo produce
            un fallo.
          </p>
          <div className="step-controls">
            <button
              className="primary-button"
              disabled={posting || busy || externalBusy}
            >
              {posting
                ? "Guardando…"
                : editingId
                  ? "Guardar cambios del flujo"
                  : "Guardar flujo"}
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => setEditing(false)}
            >
              Cancelar edición
            </button>
          </div>
        </form>
      )}
      {flows.length > 0 && (
        <>
          <div className="audit-toolbar">
            <div className="form-field">
              <label htmlFor="selected-flow">Flujo</label>
              <select
                id="selected-flow"
                value={selected}
                disabled={busy || posting}
                onChange={(event) => {
                  setSelected(event.target.value);
                  setEditing(false);
                }}
              >
                {flows.map((flow) => (
                  <option key={flow.id} value={flow.id}>
                    {flow.name}
                  </option>
                ))}
              </select>
            </div>
            <button
              className="secondary-button"
              disabled={busy || externalBusy || posting}
              onClick={() => edit(selectedFlow)}
            >
              Editar flujo
            </button>
            <button
              className="primary-button"
              disabled={
                busy || externalBusy || posting || editing || latestLoading
              }
              onClick={() => {
                void execute();
              }}
            >
              {busy ? "Flujo en ejecución…" : "Ejecutar flujo"}
            </button>
          </div>
          <p className="field-help">
            {selectedFlow?.steps.length} pasos guardados · Los hallazgos
            corresponden a la definición usada en cada ejecución.
          </p>
        </>
      )}
      {latestLoading ? (
        <p role="status">Cargando ejecución del flujo…</p>
      ) : (
        run && (
          <div className="flow-results">
            <div className="audit-heading">
              <h3>Línea de tiempo de la ejecución</h3>
              <span className={`run-status status-${run.status}`} role="status">
                {runStatus[run.status]}
              </span>
            </div>
            <p className="field-help">
              Solicitada: {new Date(run.createdAt).toLocaleString("es-PE")}.{" "}
              {run.status === "completed"
                ? "Las acciones finalizaron; revisa los hallazgos de accesibilidad."
                : "Solo los puntos de control terminados tienen resultados válidos."}
            </p>
            {run.status === "failed" && (
              <div className="error-message" role="alert">
                {run.errorMessage}
                <p>
                  El flujo está incompleto. Los pasos no ejecutados no se
                  consideran correctos.
                </p>
              </div>
            )}
            <ol className="flow-timeline">
              {run.steps.map((step) => {
                const checkpoint = run.checkpoints.find(
                  (item) => item.stepRunId === step.id,
                );
                return (
                  <li
                    key={step.id}
                    className={`timeline-${step.status}`}
                    data-testid={`flow-step-${step.position}`}
                  >
                    <div className="audit-heading">
                      <strong>
                        {step.position}. {step.label}
                      </strong>
                      <span className={`step-status step-${step.status}`}>
                        {stepStatus[step.status]}
                      </span>
                    </div>
                    <p className="field-help">
                      {actionLabels[step.definition.action]} ·{" "}
                      {step.definition.checkpoint
                        ? "Con punto de control"
                        : "Sin punto de control"}
                      {step.startedAt && step.finishedAt
                        ? ` · ${((Date.parse(step.finishedAt) - Date.parse(step.startedAt)) / 1000).toFixed(1)} s`
                        : ""}
                    </p>
                    {step.errorMessage && (
                      <p className="step-error">{step.errorMessage}</p>
                    )}
                    {checkpoint && (
                      <p className="checkpoint-summary">
                        {checkpoint.findings.length} reglas con incidencias ·{" "}
                        {checkpoint.pageTitle} · <span>{checkpoint.url}</span>
                      </p>
                    )}
                  </li>
                );
              })}
            </ol>
            {run.checkpoints.length > 0 && (
              <>
                <h3>Hallazgos por pantalla de esta ejecución</h3>
                <p className="field-help">
                  Solo se comparan puntos de control evaluados. Cada celda
                  cuenta elementos afectados por una regla; “—” indica que esa
                  regla no apareció en ese punto.
                </p>
                {ruleIds.length > 0 ? (
                  <div
                    className="table-scroll"
                    role="region"
                    aria-label="Hallazgos entre pantallas"
                    tabIndex={0}
                  >
                    <table className="findings-table screen-comparison">
                      <caption>
                        Reglas y elementos afectados por punto de control
                      </caption>
                      <thead>
                        <tr>
                          <th scope="col">Regla</th>
                          {run.checkpoints.map((checkpoint) => (
                            <th scope="col" key={checkpoint.id}>
                              Paso {checkpoint.position}: {checkpoint.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {ruleIds.map((ruleId) => (
                          <tr key={ruleId}>
                            <th scope="row">{ruleId}</th>
                            {run.checkpoints.map((checkpoint) => (
                              <td key={checkpoint.id}>
                                {checkpoint.findings.find(
                                  (finding) => finding.ruleId === ruleId,
                                )?.nodes.length ?? "—"}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p>
                    No se detectaron incidencias automáticas en los puntos
                    evaluados.
                  </p>
                )}
                <div className="filter-row">
                  <label htmlFor="flow-impact-filter">
                    Impacto en los puntos de control
                  </label>
                  <select
                    id="flow-impact-filter"
                    value={impact}
                    onChange={(event) =>
                      setImpact(event.target.value as Severity | "all")
                    }
                  >
                    <option value="all">Todos los impactos</option>
                    {["critical", "serious", "moderate", "minor"].map(
                      (value) => (
                        <option key={value}>{value}</option>
                      ),
                    )}
                  </select>
                </div>
                {run.checkpoints.map((checkpoint) => (
                  <details className="checkpoint-details" key={checkpoint.id}>
                    <summary>
                      Paso {checkpoint.position}: {checkpoint.label} —{" "}
                      {checkpoint.findings.length} reglas
                    </summary>
                    <p className="field-help">
                      {checkpoint.url} · axe-core {checkpoint.engineVersion} ·{" "}
                      {new Date(checkpoint.createdAt).toLocaleString("es-PE")}
                    </p>
                    <p className="manual-notice">
                      {checkpoint.manualReviewCount} comprobaciones incompletas
                      de axe-core. Una auditoría automática sin incidencias no
                      acredita cumplimiento WCAG.
                    </p>
                    {!checkpoint.findings.some(
                      (finding) =>
                        impact === "all" || finding.impact === impact,
                    ) && (
                      <p className="empty-result">
                        {checkpoint.findings.length === 0
                          ? "No se detectaron incidencias automáticas en este punto de control."
                          : "Ninguna regla coincide con el impacto seleccionado en este punto de control."}
                      </p>
                    )}
                    {checkpoint.findings
                      .filter(
                        (finding) =>
                          impact === "all" || finding.impact === impact,
                      )
                      .map((finding) => (
                        <article className="flow-finding" key={finding.id}>
                          <h4>
                            {finding.ruleId}{" "}
                            <span className={`impact impact-${finding.impact}`}>
                              {finding.impact}
                            </span>
                          </h4>
                          <p>{finding.description}</p>
                          <a
                            href={finding.helpUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Referencia técnica de {finding.ruleId}
                          </a>
                          {finding.nodes.map((node, index) => (
                            <div className="finding-node" key={index}>
                              <p>Selector / referencia</p>
                              <pre>{node.selector}</pre>
                              <p>HTML afectado</p>
                              <pre>{node.html}</pre>
                              {node.failureSummary && (
                                <p className="failure-summary">
                                  {node.failureSummary}
                                </p>
                              )}
                            </div>
                          ))}
                        </article>
                      ))}
                    {checkpoint.findings.filter(
                      (finding) =>
                        impact === "all" || finding.impact === impact,
                    ).length === 0 && (
                      <p>
                        No hay incidencias para el filtro seleccionado en este
                        punto.
                      </p>
                    )}
                  </details>
                ))}
              </>
            )}
          </div>
        )
      )}
    </section>
  );
}
