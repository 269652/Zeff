import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { currentAccountId, listAccounts, withAccount } from "@/db/accounts";
import { getDb, schema } from "@/db";
import { onChange } from "@/lib/events";
import { emitExtEvent, extEnv, resolveCommand } from "./hooks";
import { enabledPlugins } from "./registry";

/**
 * What the Code tab takes from external plugins — the one place Work's code calls: the rules
 * workers are told, the MCP servers they get, the "/" commands of the message box, the views in the
 * sidebar, and the event watcher. Everything is read when it's needed (a plugin's change counts at
 * once); none of it throws — a broken plugin is skipped, not Work.
 */

const MAX_RULES = 8000;

/** Text added to every worker's rules, from the plugins that may add rules ("" without any). */
export function extWorkerRules(): string {
  try {
    const parts: string[] = [];
    for (const p of enabledPlugins()) {
      if (!p.permissions.has("prompt")) continue;
      for (const rel of p.manifest.contributes.workerRules) {
        try {
          const text = fs.readFileSync(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ p.dir, rel), "utf8").trim();
          if (text) parts.push(`### ${p.manifest.name} (${p.id})\n${text.slice(0, MAX_RULES)}`);
        } catch {
          // a missing file: no rules from it
        }
      }
    }
    return parts.length ? `## Rules from the installed Zeff plugins (the user put them there)\n\n${parts.join("\n\n")}` : "";
  } catch {
    return "";
  }
}

/**
 * The MCP servers plugins give every worker, in the shape of Claude's --mcp-config. Named
 * "ext-<plugin>-<name>". A stdio server gets the plugin's API environment (ZEFF_API_URL,
 * ZEFF_EXT_TOKEN …), so it can call Zeff.
 */
export function extWorkerMcpServers(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  try {
    for (const p of enabledPlugins()) {
      for (const [name, s] of Object.entries(p.manifest.contributes.workerMcpServers)) {
        const key = `ext-${p.id}-${name}`;
        if ("command" in s) {
          if (!p.permissions.has("exec")) continue;
          const { command, args } = resolveCommand(p.dir, [s.command, ...s.args]);
          const env = extEnv(p, s.env);
          // Only what the server needs on top of the plain environment goes in the config (the CLI adds the rest).
          const own = Object.fromEntries(Object.entries(env).filter(([k]) => k.startsWith("ZEFF_") || k in s.env));
          out[key] = { type: "stdio", command, args, env: own };
        } else if (p.permissions.has("network")) {
          out[key] = { type: "http", url: s.url, ...(Object.keys(s.headers).length ? { headers: s.headers } : {}) };
        }
      }
    }
  } catch {
    // plugins' servers are extras
  }
  return out;
}

const cut = (s: string | null | undefined, n: number) => (s && s.length > n ? `${s.slice(0, n)}…` : (s ?? null));

/** What a run is for plugins: a row of the run table, or a run as Work's pages have it. */
type RunLike = {
  id: number;
  ticket: string;
  todoId: number;
  status: string;
  mode: string;
  provider: string;
  model: string | null;
  outcome: string | null;
  summary: string | null;
  error: string | null;
  branch: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  costUsd: number | null;
};

/** A run as plugins see it — in the API and in events (docs/plugins/api.md, hooks.md). tests/ext.test.ts keeps `ref` equal to workRef(). */
export function runBrief(r: RunLike) {
  return {
    id: r.id,
    ref: `W-${r.id}`,
    ticket: r.ticket,
    todoId: r.todoId,
    status: r.status,
    mode: r.mode,
    provider: r.provider,
    model: r.model,
    outcome: r.outcome,
    summary: cut(r.summary, 4000),
    error: cut(r.error, 1000),
    branch: r.branch,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    durationMs: r.durationMs,
    costUsd: r.costUsd,
  };
}

/**
 * A run started or ended: tell the plugins that listen, with the run as it is right now. Never throws, never
 * waits. (Reads the run table itself: the run store leads back to the live drivers, which import this module.)
 */
export function announceRun(id: number, event: "work.run.started" | "work.run.finished"): void {
  try {
    if (!enabledPlugins().some((p) => p.manifest.contributes.hooks[event])) return;
    const row = getDb().select().from(schema.workRuns).where(eq(schema.workRuns.id, id)).get();
    if (row) emitExtEvent(event, { run: runBrief(row) });
  } catch (e) {
    console.error("[ext] announcing run", id, "failed:", e);
  }
}

export type WorkCommand = { id: string; plugin: string; label: string; description: string; template: string };

/** The "/" menu of the message box: every enabled plugin's commands. */
export function extWorkCommands(): WorkCommand[] {
  try {
    return enabledPlugins().flatMap((p) => p.manifest.contributes.workCommands.map((c) => ({ id: `${p.id}:${c.id}`, plugin: p.manifest.name, label: c.label, description: c.description, template: c.template })));
  } catch {
    return [];
  }
}

export type WorkPanel = { id: string; plugin: string; pluginName: string; panel: string; entry: string; title: string; placement: "tab" | "session"; href: string };

/** Views plugins add to Work: their link, where to open them. */
export function extWorkPanels(placement?: "tab" | "session"): WorkPanel[] {
  try {
    return enabledPlugins().flatMap((p) =>
      p.manifest.contributes.workPanels
        .filter((x) => !placement || x.placement === placement)
        .map((x) => ({ id: `${p.id}:${x.id}`, plugin: p.id, pluginName: p.manifest.name, panel: x.id, entry: x.entry, title: x.title, placement: x.placement, href: `/ext/view/${p.id}/${x.id}` })),
    );
  } catch {
    return [];
  }
}

/**
 * Follow the app's own change bus, for the events without details (work.changed, todos.changed):
 * at most one per half second per account and topic. Started once when the server starts
 * (instrumentation.ts). Does nothing while no plugin listens.
 */
export function startExtWatcher(): void {
  const g = globalThis as { __zeffExtWatcher?: () => void };
  g.__zeffExtWatcher?.();
  const pending = new Map<string, ReturnType<typeof setTimeout>>();
  const off = onChange((topic) => {
    if (topic !== "work" && topic !== "todos") return;
    // The listener runs in the emitter's context: its account.
    const account = currentAccountId();
    const key = `${account}:${topic}`;
    if (pending.has(key)) return;
    pending.set(
      key,
      setTimeout(() => {
        pending.delete(key);
        if (!listAccounts().some((a) => a.id === account)) return;
        withAccount(account, () => emitExtEvent(topic === "work" ? "work.changed" : "todos.changed", {}));
      }, 500),
    );
  });
  g.__zeffExtWatcher = () => {
    off();
    for (const t of pending.values()) clearTimeout(t);
  };
}
