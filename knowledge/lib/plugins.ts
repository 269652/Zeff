import { FIRST_ACCOUNT, db } from "./db";

/**
 * The knowledge server's plugins, like Zeff's: where knowledge comes from (Confluence, a folder of
 * exported pages), which AI compiles and answers (Copilot CLI, Claude CLI), and reading by itself.
 * Each installed or not (the Plugins page); what an uninstalled one brings is gone, the knowledge
 * it brought stays.
 */

export const KPLUGIN_IDS = ["confluence", "zeff", "google-keep", "import-folder", "copilot-cli", "claude-cli", "auto-refresh"] as const;
export type KPluginId = (typeof KPLUGIN_IDS)[number];
export const isKPluginId = (v: unknown): v is KPluginId => (KPLUGIN_IDS as readonly unknown[]).includes(v);

export type KCategory = "source" | "ai" | "system";
export const KCATEGORY_LABELS: Record<KCategory, string> = { source: "Sources", ai: "AI backends", system: "System" };

export type KPlugin = { id: KPluginId; name: string; description: string; category: KCategory; defaultInstalled: boolean; requires?: string; provider?: AiBackend };
export type AiBackend = "copilot" | "claude";

export const KPLUGINS: KPlugin[] = [
  {
    id: "confluence",
    name: "Confluence",
    description: "Reads the pages of the chosen spaces through Confluence's REST API — only changed ones again (by version).",
    category: "source",
    defaultInstalled: true,
    requires: "CONFLUENCE_URL and CONFLUENCE_PERSONAL_TOKEN (Cloud: CONFLUENCE_USERNAME + CONFLUENCE_API_TOKEN) in Zeff's .env",
  },
  {
    id: "zeff",
    name: "Zeff",
    description: "What Zeff synced: Jira tickets with comments, Teams chats, mails, GitLab merge requests, todos with notes and AI reports, booked time, day recaps — from the Zeff account this knowledge server belongs to.",
    category: "source",
    defaultInstalled: false,
    requires: "Zeff with the Knowledge plugin installed (ZEFF_URL, default http://127.0.0.1:9333)",
  },
  {
    id: "google-keep",
    name: "Google Keep",
    description: "Your Google Keep notes and lists (with labels) — Zeff's Google Keep plugin reads them in the automation Chrome, from the Zeff account this knowledge server belongs to — and the notes of your own Keep boards that are shared with the knowledge. Included already with the Zeff source.",
    category: "source",
    defaultInstalled: false,
    requires: "Zeff with the Google Keep plugin installed (in this knowledge server's account)",
  },
  {
    id: "import-folder",
    name: "Import folder",
    description: "Reads exported pages from a folder: .json, .md, .txt, .html — subfolders are spaces.",
    category: "source",
    defaultInstalled: false,
  },
  {
    id: "copilot-cli",
    name: "GitHub Copilot CLI",
    description: "Compiles and answers with Copilot — on your Copilot subscription, models of your choice (Claude, GPT, Gemini …).",
    category: "ai",
    defaultInstalled: true,
    requires: "the Copilot CLI (npm i -g @github/copilot), signed in",
    provider: "copilot",
  },
  {
    id: "claude-cli",
    name: "Claude CLI",
    description: "Compiles and answers with Claude Code (claude -p) — with your Claude login.",
    category: "ai",
    defaultInstalled: false,
    requires: "Claude Code (claude.exe), signed in",
    provider: "claude",
  },
  {
    id: "auto-refresh",
    name: "Read automatically",
    description: "Reads the sources by itself — a few minutes after the start, then every 12 hours (KNOWLEDGE_EVERY_HOURS) — and compiles what changed.",
    category: "system",
    defaultInstalled: true,
  },
];

export const kpluginById = (id: KPluginId) => KPLUGINS.find((p) => p.id === id)!;

/** Another account's knowledge server starts empty: Confluence (the first account's, from Zeff's .env) only when you install it. */
export const defaultInstalled = (p: KPlugin) => (p.id === "confluence" && !FIRST_ACCOUNT ? false : p.defaultInstalled);

function ensure(): void {
  db().exec("create table if not exists plugins (id text primary key, installed integer not null, changed_at text not null)");
}

export function installedKPlugins(): Set<KPluginId> {
  ensure();
  const set = new Map((db().prepare("select id, installed from plugins").all() as { id: string; installed: number }[]).filter((r) => isKPluginId(r.id)).map((r) => [r.id as KPluginId, !!r.installed]));
  return new Set(KPLUGINS.filter((p) => set.get(p.id) ?? defaultInstalled(p)).map((p) => p.id));
}

export const kInstalled = (id: KPluginId) => installedKPlugins().has(id);

export function setKInstalled(id: KPluginId, installed: boolean): void {
  ensure();
  // At least one AI backend stays: without one nothing compiles or answers.
  if (!installed && kpluginById(id).category === "ai" && ![...installedKPlugins()].some((x) => x !== id && kpluginById(x).category === "ai")) {
    throw new Error("At least one AI backend stays installed.");
  }
  db().prepare("insert into plugins (id, installed, changed_at) values (?, ?, ?) on conflict(id) do update set installed = excluded.installed, changed_at = excluded.changed_at").run(id, installed ? 1 : 0, new Date().toISOString());
}

/** The AI backends installed — the first is the default. */
export const installedBackends = (): AiBackend[] => KPLUGINS.filter((p) => p.provider && kInstalled(p.id)).map((p) => p.provider!);
