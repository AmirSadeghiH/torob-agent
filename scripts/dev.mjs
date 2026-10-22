#!/usr/bin/env node
/**
 * Runs the API (tsx watch) and the Vite dev server together.
 * Ctrl+C stops both; if one dies, the other is stopped so nothing is left
 * listening behind your back.
 */
import { spawn } from "node:child_process";

const isWin = process.platform === "win32";
const npx = isWin ? "npx.cmd" : "npx";
const children = [];
let shuttingDown = false;

function run(label, args) {
  const child = spawn(npx, args, {
    stdio: "inherit",
    shell: isWin,
    env: { ...process.env, FORCE_COLOR: "1" },
  });
  child.on("error", (error) => {
    console.error(`[${label}] failed to start:`, error.message);
    shutdown(1);
  });
  child.on("exit", (code) => {
    if (!shuttingDown) {
      console.log(`[${label}] exited with ${code ?? 0}; stopping the other process.`);
      shutdown(code ?? 0);
    }
  });
  children.push({ label, child });
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const { child } of children) {
    if (child.exitCode === null) child.kill("SIGTERM");
  }
  setTimeout(() => process.exit(code), 200);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

run("api", ["tsx", "watch", "server/index.ts"]);
run("web", ["vite"]);
