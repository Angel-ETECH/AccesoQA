import type { DatabaseSync } from "node:sqlite";

export const migrations = [
  {
    version: 1,
    name: "initial-schema",
    sql: `
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        base_url TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS flows (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS flow_steps (
        id TEXT PRIMARY KEY,
        flow_id TEXT NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        label TEXT NOT NULL,
        action_type TEXT NOT NULL,
        target TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(flow_id, position)
      );
      CREATE TABLE IF NOT EXISTS audit_runs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        flow_id TEXT REFERENCES flows(id) ON DELETE SET NULL,
        status TEXT NOT NULL CHECK(status IN ('queued','running','completed','failed')),
        started_at TEXT,
        finished_at TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS audit_checkpoints (
        id TEXT PRIMARY KEY,
        audit_run_id TEXT NOT NULL REFERENCES audit_runs(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        url TEXT NOT NULL,
        title TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS findings (
        id TEXT PRIMARY KEY,
        audit_checkpoint_id TEXT NOT NULL REFERENCES audit_checkpoints(id) ON DELETE CASCADE,
        rule_id TEXT NOT NULL,
        impact TEXT NOT NULL,
        description TEXT NOT NULL,
        help TEXT NOT NULL,
        help_url TEXT NOT NULL,
        nodes_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS manual_checks (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        rule_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending','pass','fail','not_applicable')),
        notes TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_flows_project_id ON flows(project_id);
      CREATE INDEX IF NOT EXISTS idx_audit_runs_project_created ON audit_runs(project_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_findings_checkpoint ON findings(audit_checkpoint_id);
    `,
  },
  {
    version: 2,
    name: "single-page-audit-metadata",
    sql: `
      ALTER TABLE audit_runs ADD COLUMN requested_url TEXT NOT NULL DEFAULT '';
      ALTER TABLE audit_runs ADD COLUMN manual_review_count INTEGER;
      ALTER TABLE audit_runs ADD COLUMN engine_version TEXT;
    `,
  },
  {
    version: 3,
    name: "declarative-flows-and-step-runs",
    sql: `
      ALTER TABLE flow_steps ADD COLUMN definition_json TEXT NOT NULL DEFAULT '{}';
      CREATE TABLE flow_step_runs (
        id TEXT PRIMARY KEY,
        audit_run_id TEXT NOT NULL REFERENCES audit_runs(id) ON DELETE CASCADE,
        flow_step_id TEXT REFERENCES flow_steps(id) ON DELETE SET NULL,
        position INTEGER NOT NULL,
        label TEXT NOT NULL,
        definition_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending','running','completed','failed','skipped')),
        started_at TEXT,
        finished_at TEXT,
        error_message TEXT,
        UNIQUE(audit_run_id, position)
      );
      ALTER TABLE audit_checkpoints ADD COLUMN flow_step_run_id TEXT REFERENCES flow_step_runs(id);
      ALTER TABLE audit_checkpoints ADD COLUMN manual_review_count INTEGER;
      ALTER TABLE audit_checkpoints ADD COLUMN engine_version TEXT;
      CREATE INDEX idx_step_runs_audit ON flow_step_runs(audit_run_id, position);
    `,
  },
  {
    version: 4,
    name: "comparison-provenance",
    sql: `
ALTER TABLE audit_runs ADD COLUMN config_key TEXT;
CREATE INDEX idx_audit_flow_history ON audit_runs(flow_id, created_at DESC);
`,
  },
] as const;

export function runMigrations(db: DatabaseSync): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)`,
  );
  for (const migration of migrations) {
    const applied = db
      .prepare("SELECT version FROM schema_migrations WHERE version = ?")
      .get(migration.version);
    if (applied) continue;
    db.exec("BEGIN");
    try {
      db.exec(migration.sql);
      db.prepare(
        "INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)",
      ).run(migration.version, migration.name, new Date().toISOString());
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}
