#!/usr/bin/env node
/**
 * Elevated sessions without a UAC prompt each time ("Admin sessions" plugin, automatic):
 * node scripts/work-host-spool.mjs <spoolDir> <allowedCli>
 *
 * Windows' task scheduler runs this with the highest privileges (the task "\Zeff\Elevated work
 * sessions", set up once from Zeff — that one time asks for UAC). Zeff drops a session's host
 * config into the spool folder and runs the task; this starts a host (scripts/work-session-host.mjs) for
 * each config there — elevated, as this process is — and ends.
 *
 * Only the Claude CLI the task was set up with is started (its path is in the task's own
 * arguments, which only an administrator can change). Anything else in the folder is dropped.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [spool, allowed] = process.argv.slice(2);
const host = path.join(path.dirname(fileURLToPath(import.meta.url)), "work-session-host.mjs");
const same = (a, b) => path.resolve(String(a)).toLowerCase() === path.resolve(String(b)).toLowerCase();

for (const name of fs.existsSync(spool) ? fs.readdirSync(spool) : []) {
  if (!name.endsWith(".json")) continue;
  const file = path.join(spool, name);
  const claimed = `${file}.claimed`;
  try {
    fs.renameSync(file, claimed); // one starter per config, even if the task runs twice
  } catch {
    continue;
  }
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(claimed, "utf8"));
  } catch {
    fs.rmSync(claimed, { force: true });
    continue;
  }
  // The CLI itself, or node running it (a stand-in script) — nothing else.
  const cli = cfg.command && (same(cfg.command, allowed) || (same(cfg.command, process.execPath) && cfg.args?.[0] && same(cfg.args[0], allowed)));
  if (!cli || !cfg.info || !cfg.log || !cfg.err || !cfg.cwd) {
    fs.appendFileSync(path.join(spool, "refused.log"), `${new Date().toISOString()} ${name}: not the allowed CLI (${cfg.command})\n`);
    fs.rmSync(claimed, { force: true });
    continue;
  }
  const own = path.join(spool, `${path.basename(name, ".json")}.host.json`);
  fs.writeFileSync(own, JSON.stringify({ ...cfg, elevated: true }));
  fs.rmSync(claimed, { force: true });
  // Not detached: this task instance lives as long as its sessions (the scheduler may end a
  // finished task's leftovers), each run of the task its own instance.
  const child = spawn(process.execPath, [host, own], { stdio: "ignore", windowsHide: true });
  child.on("exit", () => fs.rmSync(own, { force: true }));
}
