import { CONFIG_KEY } from "../audit/history.js";
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  AuditRunSchema,
  CheckpointSchema,
  FindingSchema,
  FlowSchema,
  ProjectSchema,
  type AuditRun,
  type CreateProject,
  type CreateFlow,
  type Flow,
} from "@accesoqa/shared";
import type { ScanResult } from "../audit/scanner.js";

export class Repository {
  constructor(private readonly db: DatabaseSync) {}
  private transaction<T>(work: () => T): T {
    this.db.exec("BEGIN");
    try {
      const result = work();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  projects() {
    return this.db
      .prepare(
        "SELECT id, name, base_url AS baseUrl, created_at AS createdAt FROM projects ORDER BY created_at DESC, id",
      )
      .all()
      .map((row) => ProjectSchema.parse(row));
  }
  project(id: string) {
    return this.projects().find((project) => project.id === id);
  }
  createProject(input: CreateProject) {
    const project = {
      ...input,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    this.db
      .prepare(
        "INSERT INTO projects (id, name, base_url, created_at) VALUES (?, ?, ?, ?)",
      )
      .run(project.id, project.name, project.baseUrl, project.createdAt);
    return project;
  }
  recoverInterrupted() {
    this.transaction(() => {
      const now = new Date().toISOString();
      this.db
        .prepare(
          "UPDATE flow_step_runs SET status = 'failed', finished_at = ?, error_message = 'La API se reinició durante este paso.' WHERE status = 'running'",
        )
        .run(now);
      this.db
        .prepare(
          "UPDATE flow_step_runs SET status = 'skipped', error_message = 'No ejecutado: la auditoría se interrumpió.' WHERE status = 'pending' AND audit_run_id IN (SELECT id FROM audit_runs WHERE status IN ('queued','running'))",
        )
        .run();
      this.db
        .prepare(
          "UPDATE audit_runs SET status = 'failed', finished_at = ?, error_message = 'La API se reinició antes de finalizar la auditoría.' WHERE status IN ('queued','running')",
        )
        .run(now);
    });
  }
  createRun(projectId: string, url: string): AuditRun {
    const id = randomUUID();
    this.db
      .prepare(
        "INSERT INTO audit_runs (id, project_id, status, created_at, requested_url, config_key) VALUES (?, ?, 'queued', ?, ?, ?)",
      )
      .run(id, projectId, new Date().toISOString(), url, CONFIG_KEY);
    return this.run(id)!;
  }
  createFlowRun(flow: Flow, url: string): AuditRun {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.transaction(() => {
      this.db
        .prepare(
          "INSERT INTO audit_runs (id, project_id, flow_id, status, created_at, requested_url, config_key) VALUES (?, ?, ?, 'queued', ?, ?, ?)",
        )
        .run(id, flow.projectId, flow.id, now, url, CONFIG_KEY);
      const insert = this.db.prepare(
        "INSERT INTO flow_step_runs (id, audit_run_id, flow_step_id, position, label, definition_json, status) VALUES (?, ?, ?, ?, ?, ?, 'pending')",
      );
      for (const step of flow.steps)
        insert.run(
          randomUUID(),
          id,
          step.id,
          step.position,
          step.definition.label,
          JSON.stringify(step.definition),
        );
    });
    return this.run(id)!;
  }
  running(id: string) {
    this.db
      .prepare(
        "UPDATE audit_runs SET status = 'running', started_at = ? WHERE id = ?",
      )
      .run(new Date().toISOString(), id);
  }
  fail(id: string, message: string) {
    this.transaction(() => {
      const now = new Date().toISOString();
      this.db
        .prepare(
          "UPDATE audit_runs SET status = 'failed', error_message = ?, finished_at = ? WHERE id = ?",
        )
        .run(message, now, id);
      this.db
        .prepare(
          "UPDATE flow_step_runs SET status = 'failed', finished_at = ?, error_message = ? WHERE audit_run_id = ? AND status = 'running'",
        )
        .run(now, message, id);
      this.db
        .prepare(
          "UPDATE flow_step_runs SET status = 'skipped', error_message = 'No ejecutado: falló un paso anterior o se interrumpió el flujo.' WHERE audit_run_id = ? AND status = 'pending'",
        )
        .run(id);
    });
  }
  private insertCheckpoint(
    id: string,
    position: number,
    stepRunId: string | null,
    result: ScanResult,
  ) {
    const checkpointId = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        "INSERT INTO audit_checkpoints (id, audit_run_id, position, url, title, created_at, flow_step_run_id, manual_review_count, engine_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        checkpointId,
        id,
        position,
        result.url,
        result.title,
        now,
        stepRunId,
        result.manualReviewCount,
        result.engineVersion,
      );
    const insert = this.db.prepare(
      "INSERT INTO findings (id, audit_checkpoint_id, rule_id, impact, description, help, help_url, nodes_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    const seen = new Set<string>();
    for (const finding of result.findings) {
      const nodes = finding.nodes.filter((node) => {
        const key = JSON.stringify([finding.ruleId, node.selector]);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      if (!nodes.length) continue;
      insert.run(
        randomUUID(),
        checkpointId,
        finding.ruleId,
        finding.impact,
        finding.description,
        finding.help,
        finding.helpUrl,
        JSON.stringify(nodes),
        now,
      );
    }
  }
  complete(id: string, result: ScanResult) {
    this.transaction(() => {
      this.insertCheckpoint(id, 0, null, result);
      this.finishRun(id, result.manualReviewCount, result.engineVersion);
    });
  }
  finishRun(
    id: string,
    manualReviewCount: number,
    engineVersion: string | null,
  ) {
    this.db
      .prepare(
        "UPDATE audit_runs SET status = 'completed', finished_at = ?, manual_review_count = ?, engine_version = ? WHERE id = ?",
      )
      .run(new Date().toISOString(), manualReviewCount, engineVersion, id);
  }
  startStep(id: string, position: number) {
    this.db
      .prepare(
        "UPDATE flow_step_runs SET status = 'running', started_at = ? WHERE audit_run_id = ? AND position = ?",
      )
      .run(new Date().toISOString(), id, position);
  }
  completeStep(id: string, position: number, result: ScanResult | null) {
    this.transaction(() => {
      const step = this.db
        .prepare(
          "SELECT id FROM flow_step_runs WHERE audit_run_id = ? AND position = ?",
        )
        .get(id, position);
      if (!step) throw new Error("No se encontró el paso de la ejecución.");
      if (result) this.insertCheckpoint(id, position, String(step.id), result);
      this.db
        .prepare(
          "UPDATE flow_step_runs SET status = 'completed', finished_at = ? WHERE id = ?",
        )
        .run(new Date().toISOString(), String(step.id));
    });
  }
  flows(projectId: string): Flow[] {
    return this.db
      .prepare(
        "SELECT id FROM flows WHERE project_id = ? ORDER BY created_at DESC, rowid DESC",
      )
      .all(projectId)
      .map((row) => this.flow(String(row.id))!);
  }
  flow(id: string): Flow | null {
    const row = this.db
      .prepare(
        "SELECT id, project_id AS projectId, name, created_at AS createdAt FROM flows WHERE id = ?",
      )
      .get(id);
    if (!row) return null;
    const steps = this.db
      .prepare(
        "SELECT id, position, definition_json AS definition FROM flow_steps WHERE flow_id = ? ORDER BY position",
      )
      .all(id)
      .map((step) => ({
        ...step,
        definition: JSON.parse(String(step.definition)) as unknown,
      }));
    return FlowSchema.parse({ ...row, steps });
  }
  saveFlow(projectId: string, input: CreateFlow, existingId?: string): Flow {
    const id = existingId ?? randomUUID();
    const now = new Date().toISOString();
    this.transaction(() => {
      if (existingId) {
        this.db
          .prepare("UPDATE flows SET name = ? WHERE id = ?")
          .run(input.name, id);
        this.db.prepare("DELETE FROM flow_steps WHERE flow_id = ?").run(id);
      } else
        this.db
          .prepare(
            "INSERT INTO flows (id, project_id, name, created_at) VALUES (?, ?, ?, ?)",
          )
          .run(id, projectId, input.name, now);
      const insert = this.db.prepare(
        "INSERT INTO flow_steps (id, flow_id, position, label, action_type, definition_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      );
      input.steps.forEach((step, index) =>
        insert.run(
          randomUUID(),
          id,
          index + 1,
          step.label,
          step.action,
          JSON.stringify(step),
          now,
        ),
      );
    });
    return this.flow(id)!;
  }
  latest(projectId: string) {
    const row = this.db
      .prepare(
        "SELECT id FROM audit_runs WHERE project_id = ? AND flow_id IS NULL ORDER BY created_at DESC, rowid DESC LIMIT 1",
      )
      .get(projectId);
    return row ? this.run(String(row.id)) : null;
  }
  latestFlow(flowId: string) {
    const row = this.db
      .prepare(
        "SELECT id FROM audit_runs WHERE flow_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1",
      )
      .get(flowId);
    return row ? this.run(String(row.id)) : null;
  }
  precedes(baselineId: string, currentId: string) {
    const row = this.db
      .prepare(
        "SELECT a.rowid < b.rowid AS valid FROM audit_runs a,audit_runs b WHERE a.id=? AND b.id=?",
      )
      .get(baselineId, currentId);
    return row?.valid === 1;
  }
  history(projectId: string, limit: number, offset: number) {
    const total = Number(
      this.db
        .prepare("SELECT count(*) total FROM audit_runs WHERE project_id=?")
        .get(projectId)!.total,
    );
    const items = this.db
      .prepare(
        "SELECT id, flow_id AS flowId, status, created_at AS createdAt, finished_at AS finishedAt, error_message AS errorMessage FROM audit_runs WHERE project_id=? ORDER BY created_at DESC,rowid DESC LIMIT ? OFFSET ?",
      )
      .all(projectId, limit, offset);
    return { total, items, limit, offset };
  }
  run(id: string): AuditRun | null {
    const row = this.db
      .prepare(
        `SELECT id, config_key AS configKey, project_id AS projectId, flow_id AS flowId, status, created_at AS createdAt, started_at AS startedAt, finished_at AS finishedAt, error_message AS errorMessage, requested_url AS requestedUrl, manual_review_count AS manualReviewCount, engine_version AS engineVersion FROM audit_runs WHERE id = ?`,
      )
      .get(id);
    if (!row) return null;
    const steps = this.db
      .prepare(
        `SELECT id, position, label, definition_json AS definition, status, started_at AS startedAt, finished_at AS finishedAt, error_message AS errorMessage FROM flow_step_runs WHERE audit_run_id = ? ORDER BY position`,
      )
      .all(id)
      .map((step) => ({
        ...step,
        definition: JSON.parse(String(step.definition)) as unknown,
      }));
    const findings = this.db
      .prepare(
        `SELECT f.id, f.rule_id AS ruleId, f.description, f.impact, f.help, f.help_url AS helpUrl, f.nodes_json AS nodes, f.created_at AS createdAt, c.url, c.title AS pageTitle, c.id AS checkpointId, s.position AS stepPosition, s.label AS stepLabel FROM findings f JOIN audit_checkpoints c ON c.id = f.audit_checkpoint_id LEFT JOIN flow_step_runs s ON s.id = c.flow_step_run_id WHERE c.audit_run_id = ? ORDER BY c.position, f.rowid`,
      )
      .all(id)
      .map((finding) =>
        FindingSchema.parse({
          ...finding,
          nodes: JSON.parse(String(finding.nodes)) as unknown,
        }),
      );
    const checkpoints = this.db
      .prepare(
        `SELECT c.id, c.flow_step_run_id AS stepRunId, c.position, COALESCE(s.label, 'Página individual') AS label, c.url, c.title AS pageTitle, c.created_at AS createdAt, c.manual_review_count AS manualReviewCount, c.engine_version AS engineVersion FROM audit_checkpoints c LEFT JOIN flow_step_runs s ON s.id = c.flow_step_run_id WHERE c.audit_run_id = ? ORDER BY c.position`,
      )
      .all(id)
      .map((checkpoint) =>
        CheckpointSchema.parse({
          ...checkpoint,
          findings: findings.filter(
            (finding) => finding.checkpointId === checkpoint.id,
          ),
        }),
      );
    const last = checkpoints.at(-1);
    return AuditRunSchema.parse({
      ...row,
      steps,
      checkpoints,
      findings,
      url: last?.url ?? null,
      pageTitle: last?.pageTitle ?? null,
      findingsCount: row.status === "completed" ? findings.length : null,
    });
  }
}
