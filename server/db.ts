import "./lib/env";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { existsSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Read-only access to the imported SQLite database. The import is an explicit
 * command (`npm run data:import`); the server never writes to the data file.
 *
 * The database is opened on first use, never at import time. A fresh checkout
 * without `data/hamkharid.db` still boots and serves the UI, and reports the
 * missing import honestly instead of crashing the process.
 */
export const dbPath = process.env.HAMKHARID_DB
  ? path.resolve(process.env.HAMKHARID_DB)
  : path.resolve(process.cwd(), "data", "hamkharid.db");

const MISSING_MESSAGE = `Database not found at ${dbPath}. Run "npm run data:import" (or "python scripts/import_dataset.py") first.`;

let database: DatabaseSync | null = null;
const cache = new Map<string, StatementSync>();

function open(): DatabaseSync {
  if (database) return database;
  if (!existsSync(dbPath)) throw new Error(MISSING_MESSAGE);
  const opened = new DatabaseSync(dbPath, { readOnly: true });
  opened.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 5000;");
  database = opened;
  return opened;
}

/** True when the data file exists and is not empty (opened lazily on first query). */
export function dbReady(): boolean {
  return database !== null || (existsSync(dbPath) && statSync(dbPath).size > 0);
}

/** The honest reason the database cannot be read, or null when it is fine. */
export function dbMissingMessage(): string | null {
  return dbReady() ? null : MISSING_MESSAGE;
}

function statement(sql: string): StatementSync {
  const handle = open();
  let stmt = cache.get(sql);
  if (!stmt) {
    stmt = handle.prepare(sql);
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

export function dbSizeMb(): number | null {
  if (!existsSync(dbPath)) return null;
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
