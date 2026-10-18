// Where each part of Zeff runs: on this computer ("host", the default — everything as it always was) or in a Docker container
// ("docker"). Kept in <state>/modes.json, written by the settings in the status window.
//
//   stack      the pages + the sync host + the work host — ONE switch: they share the database (data/zeff.db), and two worlds
//              (a service on Windows, another in a container) writing one SQLite file do not share file locks
//   knowledge  the knowledge server(s): their own data folders, no database to share
//   claude / copilot / codex   the AI CLIs the workers run: each through its own shim (scripts/<tool>-docker.mjs) into the AI-tools
//              container — while the stack is in Docker, its container has the CLIs in it and these three do not matter
const fs = require("node:fs");
const path = require("node:path");

const SERVICES = [
  { id: "stack", label: "Zeff — pages, sync host, work host", hint: "One switch: the three share the database, so they run together." },
  { id: "knowledge", label: "Knowledge servers", hint: "Each account's knowledge base; own data, no shared database." },
  { id: "claude", label: "Claude Code CLI", hint: "The workers' Claude runs in the AI-tools container; the repos are mounted." },
  { id: "copilot", label: "GitHub Copilot CLI", hint: "In the AI-tools container; sign in once there." },
  { id: "codex", label: "Codex CLI", hint: "In the AI-tools container; sign in once there." },
];
const IDS = SERVICES.map((s) => s.id);
const CLIS = ["claude", "copilot", "codex"];
const CLI_VARS = { claude: "CLAUDE_CLI", copilot: "COPILOT_CLI", codex: "CODEX_CLI" };
const MODES = ["host", "docker"];

/** Everything on the host — except what the older setting `claudeDocker` asked for. */
const defaults = (cfg = {}) => ({ stack: "host", knowledge: "host", claude: cfg.claudeDocker === true ? "docker" : "host", copilot: "host", codex: "host" });

/** What is given, held to what exists: a known service, "host" or "docker"; the rest as the base has it. */
function sanitize(input, base = defaults()) {
  const out = { ...base };
  if (input && typeof input === "object") for (const id of IDS) if (MODES.includes(input[id])) out[id] = input[id];
  return out;
}

const file = (stateDir) => path.join(stateDir, "modes.json");

function read(stateDir, cfg) {
  try {
    return sanitize(JSON.parse(fs.readFileSync(file(stateDir), "utf8")), defaults(cfg));
  } catch {
    return defaults(cfg);
  }
}

function write(stateDir, modes) {
  const clean = sanitize(modes, defaults());
  fs.mkdirSync(stateDir, { recursive: true });
  const tmp = `${file(stateDir)}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(clean, null, 2));
  fs.renameSync(tmp, file(stateDir));
  return clean;
}

/** Whether the AI-tools container is needed: a CLI is switched to Docker and the stack is on the host (the stack's own container has them). */
const aiContainerNeeded = (modes) => modes.stack !== "docker" && CLIS.some((c) => modes[c] === "docker");

/**
 * The environment that makes the host-side services run a CLI through its shim (Zeff runs a .mjs CLI with node — see findClaudeCli). Nothing
 * while the stack is in Docker: its container runs them itself.
 */
function cliEnv(modes, appDir) {
  if (modes.stack === "docker") return {};
  const env = {};
  for (const c of CLIS) if (modes[c] === "docker") env[CLI_VARS[c]] = path.join(appDir, "scripts", `${c}-docker.mjs`);
  return env;
}

/** What the settings page tells next to a switch (empty: nothing to say). */
function notes(modes) {
  const out = {};
  if (modes.stack === "docker") for (const c of CLIS) out[c] = "Runs inside the Zeff container (it has the CLIs).";
  if (modes.stack === "docker" && modes.knowledge === "host") out.knowledge = "On the host: the Zeff container reaches it at host.docker.internal.";
  return out;
}

module.exports = { SERVICES, IDS, CLIS, CLI_VARS, MODES, defaults, sanitize, read, write, aiContainerNeeded, cliEnv, notes };
