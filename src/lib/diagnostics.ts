import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * The diagnostics report: one plain text — what runs here, what is installed, how the last syncs went, the
 * ends of the logs. It is made on request, shown on the page for you to read, and only goes where you send
 * it (copy or save). Emails, tokens, passwords and your user folder are blacked out first.
 */

/** Blacks out what shouldn't leave the PC: tokens and keys, passwords, email addresses, the user folder, IPs of the LAN. */
export function redact(text: string, home: string = os.homedir(), user: string = os.userInfo().username): string {
  let s = text;
  if (home.length > 3) s = s.split(home).join("~").split(home.replace(/\\/g, "/")).join("~");
  if (user.length > 2) s = s.replace(new RegExp(`(?<![A-Za-z0-9])${user.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9])`, "gi"), "<user>");
  return s
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]{12,}=*/g, "Bearer <redacted>")
    .replace(/(authorization|token|secret|password|passwd|api[-_ ]?key|cookie)(["']?\s*[:=]\s*["']?)(?!Bearer )[^\s"',;]{4,}/gi, "$1$2<redacted>")
    .replace(/\b(?:sk|ghp|gho|ghu|ghs|github_pat|glpat|xox[bap]|AIza)[-_A-Za-z0-9]{16,}/g, "<redacted>")
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, "<redacted>")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "<email>");
}

/** The last `lines` lines of a file ("" when it isn't there). */
export function tail(file: string, lines = 150, bytes = 64 * 1024): string {
  try {
    const size = fs.statSync(/*turbopackIgnore: true*/ file).size;
    const fd = fs.openSync(/*turbopackIgnore: true*/ file, "r");
    try {
      const len = Math.min(size, bytes);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, size - len);
      return buf.toString("utf8").split(/\r?\n/).slice(-lines).join("\n");
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return "";
  }
}

export type DiagnosticsInput = {
  version: string;
  data: string;
  plugins: string[];
  prerequisites: { label: string; found: string | null }[];
  syncs: { label: string; lastAt: string | null; lastOk: boolean | null; lastMessage: string | null }[];
  logins: { label: string; state: string }[];
  attention: string[];
  logDir: string | null;
  now?: Date;
};

/** The report text (already redacted). */
export function buildReport(i: DiagnosticsInput): string {
  const out: string[] = [];
  const h = (title: string) => out.push("", `== ${title} ==`);
  out.push(`Zeff diagnostics — ${(i.now ?? new Date()).toISOString()}`);
  out.push("Made on request. Emails, tokens, passwords and your user folder are blacked out; read it before you send it.");
  h("System");
  out.push(`Zeff ${i.version}`, `${os.type()} ${os.release()} (${process.platform} ${process.arch}), ${Math.round(os.totalmem() / 2 ** 30)} GB RAM`, `Node ${process.version}`, `Data: ${i.data}`);
  h("Programs this PC brings");
  for (const p of i.prerequisites) out.push(`${p.found ? "✓" : "✗"} ${p.label}${p.found ? ` — ${p.found}` : " — not found"}`);
  h("Installed plugins");
  out.push(i.plugins.join(", ") || "(none)");
  h("Sign-ins");
  for (const l of i.logins) out.push(`${l.label}: ${l.state}`);
  if (!i.logins.length) out.push("(none)");
  h("Needs you now");
  out.push(...(i.attention.length ? i.attention : ["(nothing)"]));
  h("Syncs");
  for (const s of i.syncs) out.push(`${s.lastOk === false ? "✗" : s.lastOk ? "✓" : "·"} ${s.label} — ${s.lastAt ?? "never"}${s.lastMessage ? ` — ${s.lastMessage.replace(/\s+/g, " ").slice(0, 300)}` : ""}`);
  if (i.logDir) {
    for (const f of ["launcher.log", "zeff.log", "knowledge.log", "work.log"]) {
      const t = tail(path.join(i.logDir, f));
      if (t.trim()) {
        h(`Log: ${f} (the end)`);
        out.push(t);
      }
    }
  }
  return redact(out.join("\n"));
}

/** Gathers what the report needs from this running Zeff and builds it. Server only. */
export async function diagnosticsReport(): Promise<string> {
  const { dataDir } = await import("@/db");
  const { installedPlugins } = await import("@/plugins/state");
  const { prerequisites } = await import("@/lib/prerequisites");
  const { syncOverview } = await import("@/lib/sync/registry");
  const { listLogins } = await import("@/lib/logins");
  const { listAttention } = await import("@/lib/attention");
  const pkg = JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ path.join(process.cwd(), "package.json"), "utf8")) as { version?: string };
  const data = dataDir();
  const safe = async <T>(fn: () => Promise<T> | T, fallback: T): Promise<T> => {
    try {
      return await fn();
    } catch {
      return fallback;
    }
  };
  const logins = await safe(async () => (await listLogins()).logins.map((l) => ({ label: l.label, state: l.state })), []);
  const attention = await safe(async () => (await listAttention()).map((a) => `${a.title} — ${a.body}`.slice(0, 300)), []);
  return buildReport({
    version: pkg.version ?? "?",
    data,
    plugins: [...installedPlugins()].sort(),
    prerequisites: prerequisites().map((p) => ({ label: p.label, found: p.found })),
    syncs: syncOverview().steps.map((s) => ({ label: s.label, lastAt: s.lastAt, lastOk: s.lastOk, lastMessage: s.lastMessage })),
    logins,
    attention,
    logDir: [path.join(data, "logs"), path.join(path.dirname(data), "logs")].find((d) => fs.existsSync(/*turbopackIgnore: true*/ d)) ?? null,
  });
}
