import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "./database.js";

describe("migraciones SQLite", () => {
  let directory = "";
  afterEach(() => {
    if (directory) rmSync(directory, { recursive: true, force: true });
  });

  it("crea las entidades iniciales y se puede ejecutar de nuevo", () => {
    directory = mkdtempSync(join(tmpdir(), "accesoqa-"));
    const path = join(directory, "test.sqlite");
    const db = openDatabase(path);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => (row as { name: string }).name);
    expect(tables).toEqual(
      expect.arrayContaining([
        "projects",
        "flows",
        "flow_steps",
        "audit_runs",
        "audit_checkpoints",
        "findings",
        "manual_checks",
      ]),
    );
    db.close();
    const reopened = openDatabase(path);
    expect(
      reopened.prepare("SELECT count(*) AS count FROM schema_migrations").get(),
    ).toEqual({ count: 4 });
    reopened.close();
  });
});
