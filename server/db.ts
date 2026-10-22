import { DatabaseSync, type StatementSync } from "node:sqlite";
import { existsSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Read-only access to the imported SQLite database. The import is an explicit
 * command (`npm run data:import`); the server never writes to the data file.
 */
export const dbPath = process.env.HAMKHARID_DB
  ? path.resolve(process.env.HAMKHARID_DB)
  : path.resolve(process.cwd(), "data", "hamkharid.db");

if (!existsSync(dbPath)) {
  throw new Error(
    `Database not found at ${dbPath}. Run "npm run data:import" (or "python scripts/import_dataset.py") first.`,
  );
}

export const db = new DatabaseSync(dbPath, { readOnly: true });
db.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 5000;");

const cache = new Map<string, StatementSync>();

function statement(sql: string): StatementSync {
  let stmt = cache.get(sql);
  if (!stmt) {
    stmt = db.prepare(sql);
    cache.set(sql, stmt);
  }
  return stmt;
}

export type SqlParam = string | number | null;

export function all<T>(sql: string, params: SqlParam[] = []): T[] {
  return statement(sql).all(...params) as T[];
}

export function get<T>(sql: string, params: SqlParam[] = []): T | undefined {
  return statement(sql).get(...params) as T | undefined;
}

export function dbSizeMb(): number {
  return Math.round((statSync(dbPath).size / (1024 * 1024)) * 10) / 10;
}

export function readMeta<T>(key: string): T | null {
  const row = get<{ value: string }>("SELECT value FROM meta WHERE key = ?", [key]);
  if (!row) return null;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return null;
  }
}

interface CountRow {
  n: number;
}
export function tableCount(table: "products" | "offers" | "shops"): number {
  const row = get<CountRow>(`SELECT COUNT(*) AS n FROM ${table}`);
  return row?.n ?? 0;
}
