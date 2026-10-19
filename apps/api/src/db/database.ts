import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { runMigrations } from "./migrations.js";

const defaultDatabasePath = fileURLToPath(
  new URL("../../../../data/accesoqA.sqlite", import.meta.url),
);

export function openDatabase(
  filePath = process.env.ACCESOQA_DB_PATH ?? defaultDatabasePath,
) {
  const absolutePath = filePath === ":memory:" ? filePath : resolve(filePath);
  if (filePath !== ":memory:")
    mkdirSync(dirname(absolutePath), { recursive: true });
  const db = new DatabaseSync(absolutePath);
  try {
    db.exec(
      "PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;",
    );
    runMigrations(db);
  } catch (error) {
    db.close();
    throw error;
  }
  return db;
}
