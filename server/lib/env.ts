import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Server-side `.env` loader. Vite only exposes `VITE_*` variables to the
 * browser, so provider keys read here never reach the client bundle.
 *
 * Evaluated once at import time, before `db.ts` resolves its path, so
 * `HAMKHARID_DB` / `PORT` from `.env` still apply. Existing environment
 * variables win: `process.loadEnvFile` never overwrites them.
 */
let loaded = false;

export function loadServerEnv(): void {
  if (loaded) return;
  loaded = true;
  const file = path.resolve(process.cwd(), ".env");
  if (!existsSync(file)) return;
  try {
    process.loadEnvFile(file);
  } catch {
    // A malformed `.env` must not stop the API from starting.
  }
}

loadServerEnv();

/** Trimmed environment value, or null when unset/empty. */
export function envValue(key: string): string | null {
  const raw = process.env[key];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}
