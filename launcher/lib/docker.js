// What Docker is doing, for the status window: the containers (all of them, running or not) with Zeff's marked. Asking is cheap and
// bounded: `docker ps` with a timeout — Docker not installed, not running or slow is an answer, not an error.
const { execFile } = require("node:child_process");

const run = (args, timeout = 6000) =>
  new Promise((resolve) => {
    execFile("docker", args, { timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, stdout: String(stdout ?? ""), stderr: String(stderr || err?.message || "") });
    });
  });

/** A line of `docker ps --format {{json .}}` as the window shows it. */
function toContainer(line) {
  let j;
  try {
    j = JSON.parse(line);
  } catch {
    return null;
  }
  const labels = String(j.Labels ?? "");
  const service = /(?:^|,)zeff\.service=([^,]+)/.exec(labels)?.[1] ?? null;
  const name = String(j.Names ?? "");
  return {
    id: String(j.ID ?? "").slice(0, 12),
    name,
    image: String(j.Image ?? ""),
    state: String(j.State ?? ""),
    status: String(j.Status ?? ""),
    ports: String(j.Ports ?? ""),
    service,
    // Zeff's own: the services it starts (labelled) and the AI-tools container.
    zeff: !!service || /^zeff-/.test(name),
  };
}

/** { available, error?, containers } — running first, Zeff's before the others. */
async function list() {
  const r = await run(["ps", "-a", "--format", "{{json .}}"]);
  if (r.code !== 0) {
    const missing = /ENOENT|not recognized|nicht gefunden/i.test(r.stderr);
    return { available: false, error: missing ? "Docker is not installed." : /daemon|pipe|connect|Cannot connect|error during connect/i.test(r.stderr) ? "Docker is not running." : r.stderr.trim().split(/\r?\n/)[0].slice(0, 200), containers: [] };
  }
  const containers = r.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map(toContainer)
    .filter(Boolean)
    .sort((a, b) => Number(b.state === "running") - Number(a.state === "running") || Number(b.zeff) - Number(a.zeff) || a.name.localeCompare(b.name));
  return { available: true, containers };
}

/** Stop and remove a container of Zeff's by name (the launcher's Stop of a service that runs in Docker). */
const remove = (name) => run(["rm", "-f", name], 15000);

module.exports = { list, toContainer, remove, run };
