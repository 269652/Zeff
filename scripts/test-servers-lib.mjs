/**
 * The pure parts of the disposable test servers (scripts/test-server.mjs): the registry of what was started (a JSON file in
 * the temp folder, shared by every checkout and worktree), when an entry has outlived its time, and which running `next`
 * processes may be reaped. No processes are looked at or killed here — that is test-server.mjs's.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** The registry: every test server started on this computer, from any checkout. */
export const REGISTRY_FILE = path.join(os.tmpdir(), "zeff-test-servers.json");

/** On a test server's command line (node's --title — harmless, and visible to the process list): "this is a test server". */
export const MARKER = "--title=zeff-test-server";

export const DEFAULT_TTL_MS = 30 * 60_000;

/** The user's live Zeff — never touched. */
export const PROTECTED_PORTS = [9333];

/** The entries, oldest first. A missing or broken file is an empty registry. */
export function readRegistry(file = REGISTRY_FILE) {
  try {
    const v = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(v) ? v.filter((e) => e && typeof e.pid === "number") : [];
  } catch {
    return [];
  }
}

export function writeRegistry(file, entries) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const part = `${file}.${process.pid}.part`;
  fs.writeFileSync(part, JSON.stringify(entries, null, 2));
  fs.renameSync(part, file);
}

/** An entry added (one of the same pid replaced). */
export function addEntry(file, entry) {
  writeRegistry(file, [...readRegistry(file).filter((e) => e.pid !== entry.pid), entry]);
}

export function removeEntry(file, pid) {
  const all = readRegistry(file);
  const left = all.filter((e) => e.pid !== pid);
  if (left.length !== all.length) writeRegistry(file, left);
}

export const expiresAt = (e) => e.startedAt + e.ttlMs;
export const isExpired = (e, now) => now >= expiresAt(e);

const norm = (p) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
const under = (p, dir) => norm(p) === norm(dir) || norm(p).startsWith(`${norm(dir)}/`);

/** The checkout a `next` command line runs from: the folder above its node_modules/next (as written), else null. */
export function checkoutOf(cmdline) {
  const m = /(?:"([^"]+?)[\\/]node_modules[\\/]next[\\/][^"]*"|([^\s"]+?)[\\/]node_modules[\\/]next[\\/])/.exec(cmdline ?? "");
  return m ? (m[1] ?? m[2]) : null;
}

/** A `next dev` / `next start` or the server child they start. */
const isNextServer = (cmdline) => /node_modules[\\/]next[\\/]dist[\\/](bin[\\/]next"?\s+(dev|start)\b|server[\\/]lib[\\/]start-server\.js)/.test(cmdline ?? "");

/**
 * What --reap kills: [{pid, reason, cmdline}], each a tree's root (a child of one already listed goes with its tree).
 *
 *  - a registered test server past its TTL (still a marked next process — a pid reused by something else is left alone);
 *  - an unregistered marked one older than the default TTL;
 *  - an unregistered next server older than the default TTL that runs from a worktree (not the main checkout) or a temp folder;
 *
 * and never one on a protected port (9333), nor anything above or below it, nor one of the main checkout without the marker.
 *
 * `processes`: [{pid, ppid, cmdline, startedAt, port?}]; times in ms.
 *
 * @param {{ pid: number, ppid: number, cmdline: string, startedAt: number, port?: number }[]} processes
 * @param {{ now: number, ttlMs?: number, registry?: { pid: number, port: number, startedAt: number, ttlMs: number }[], mainCheckout: string, worktrees?: string[], tmpDir?: string, protectedPorts?: number[] }} opts
 * @returns {{ pid: number, reason: string, cmdline: string }[]}
 */
export function reapPlan(processes, { now, ttlMs = DEFAULT_TTL_MS, registry = [], mainCheckout, worktrees = [], tmpDir = os.tmpdir(), protectedPorts = PROTECTED_PORTS }) {
  const byPid = new Map(processes.map((p) => [p.pid, p]));
  const children = new Map();
  for (const p of processes) children.set(p.ppid, [...(children.get(p.ppid) ?? []), p]);
  const guarded = new Set();
  const up = (p) => {
    for (let x = p, seen = 0; x && seen < 64 && !guarded.has(x.pid); x = byPid.get(x.ppid), seen++) guarded.add(x.pid);
  };
  const down = (p) => {
    guarded.add(p.pid);
    for (const c of children.get(p.pid) ?? []) if (!guarded.has(c.pid)) down(c);
  };
  for (const p of processes) {
    if (p.port != null && protectedPorts.includes(p.port)) {
      up(p);
      down(p);
    }
  }
  const registered = new Map(registry.map((e) => [e.pid, e]));
  // (A worktree may sit inside the main checkout — .claude/worktrees/x: it counts as a worktree.)
  const others = worktrees.filter((w) => norm(w) !== norm(mainCheckout));
  const why = (p) => {
    if (guarded.has(p.pid) || !isNextServer(p.cmdline)) return null;
    const marked = p.cmdline.includes(MARKER);
    const e = registered.get(p.pid);
    if (e) return marked && isExpired(e, now) ? `registered test server (port ${e.port}), its TTL passed` : null;
    if (now - p.startedAt < ttlMs) return null;
    if (marked) return "marked test server, unregistered, older than the TTL";
    const root = checkoutOf(p.cmdline);
    if (!root) return null;
    if (others.some((w) => under(root, w))) return `next server in a worktree (${root}), older than the TTL`;
    if (under(root, mainCheckout)) return null;
    if (under(root, tmpDir)) return `next server in a temp folder (${root}), older than the TTL`;
    return null;
  };
  const picked = new Map();
  for (const p of processes) {
    const reason = why(p);
    if (reason) picked.set(p.pid, { pid: p.pid, reason, cmdline: p.cmdline });
  }
  // Roots only: a child of a listed process goes with its tree.
  const hasPickedAncestor = (p) => {
    for (let x = byPid.get(p.ppid), seen = 0; x && seen < 64; x = byPid.get(x.ppid), seen++) if (picked.has(x.pid)) return true;
    return false;
  };
  return [...picked.values()].filter((r) => !hasPickedAncestor(byPid.get(r.pid)));
}
