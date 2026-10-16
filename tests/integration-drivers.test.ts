import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

/**
 * Every browser driver a mounted integration brings (Chrono, Punch …) starts: a driver that fails to load — a wrong import path
 * after the code moved — makes every pull and export fail with "exited early", and nothing says why until a sync is tried.
 * Started with unroutable browser endpoints (it must not launch the automation Chrome), stopped as soon as it says it's ready.
 */
const drivers = (): string[] => {
  const base = path.join(process.cwd(), "integrations");
  if (!fs.existsSync(base)) return [];
  const found: string[] = [];
  for (const m of fs.readdirSync(base, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith("."))) {
    for (const p of fs.readdirSync(path.join(base, m.name), { withFileTypes: true }).filter((e) => e.isDirectory())) {
      const file = path.join(base, m.name, p.name, "driver.mjs");
      if (fs.existsSync(file)) found.push(file);
    }
  }
  return found;
};

for (const file of drivers()) {
  test(`${path.relative(process.cwd(), file)} starts`, async () => {
    const dead = "http://192.0.2.1:9222";
    const child = spawn(process.execPath, [file], { stdio: ["pipe", "ignore", "pipe"], env: { ...process.env, CHRONO_CDP_ENDPOINT: dead, PUNCH_CDP_ENDPOINT: dead, TEAMS_CDP_ENDPOINT: dead, GITLAB_CDP_ENDPOINT: dead } });
    let err = "";
    const outcome = await new Promise<string>((resolve) => {
      const timer = setTimeout(() => resolve("timeout"), 15000);
      child.stderr!.on("data", (d) => {
        err += d;
        if (/ready/i.test(err)) resolve("ready");
      });
      child.on("exit", (code) => resolve(`exited ${code}`));
      child.on("error", (e) => resolve(`error ${e.message}`));
      void timer;
    });
    child.kill();
    assert.equal(outcome, "ready", `the driver didn't start: ${outcome}\n${err.slice(0, 600)}`);
  });
}
