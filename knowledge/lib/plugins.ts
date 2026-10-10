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
export const KCATEGORY_LABELS: Record<KCategory, string> = { source: "Quellen", ai: "KI-Backends", system: "System" };

export type KPlugin = { id: KPluginId; name: string; description: string; category: KCategory; defaultInstalled: boolean; requires?: string; provider?: AiBackend };
export type AiBackend = "copilot" | "claude";

export const KPLUGINS: KPlugin[] = [
  {
    id: "confluence",
    name: "Confluence",
    description: "Liest die Seiten der eingestellten Bereiche über Confluences REST-API — nur geänderte neu (nach Version).",
    category: "source",
    defaultInstalled: true,
    requires: "CONFLUENCE_URL und CONFLUENCE_PERSONAL_TOKEN (Cloud: CONFLUENCE_USERNAME + CONFLUENCE_API_TOKEN) in Zeffs .env",
  },
  {
    id: "zeff",
    name: "Zeff",
    description: "Was Zeff synchronisiert hat: Jira-Tickets mit Kommentaren, Teams-Chats, Mails, GitLab-Merge-Requests, Todos mit Notizen und KI-Berichten, gebuchte Zeiten, Tagesrückblicke — aus dem Zeff-Konto, dem dieser Wissens-Server gehört.",
    category: "source",
    defaultInstalled: false,
    requires: "Zeff mit installiertem Knowledge-Plugin (ZEFF_URL, Standard http://127.0.0.1:9333)",
  },
  {
    id: "google-keep",
    name: "Google Keep",
    description: "Deine Google-Keep-Notizen und -Listen (mit Labels) — Zeffs Google-Keep-Plugin liest sie im Automations-Chrome, aus dem Zeff-Konto, dem dieser Wissens-Server gehört. Mit der Zeff-Quelle zusammen schon dabei.",
    category: "source",
    defaultInstalled: false,
    requires: "Zeff mit installiertem Google-Keep-Plugin (im Konto dieses Wissens-Servers)",
  },
  {
    id: "import-folder",
    name: "Import-Ordner",
    description: "Liest exportierte Seiten aus einem Ordner: .json, .md, .txt, .html — Unterordner sind Bereiche.",
    category: "source",
    defaultInstalled: false,
  },
  {
    id: "copilot-cli",
    name: "GitHub Copilot CLI",
    description: "Kompiliert und beantwortet mit Copilot — mit deinem Copilot-Abo, Modelle nach Wahl (Claude, GPT, Gemini …).",
    category: "ai",
    defaultInstalled: true,
    requires: "die Copilot CLI (npm i -g @github/copilot), angemeldet",
    provider: "copilot",
  },
  {
    id: "claude-cli",
    name: "Claude CLI",
    description: "Kompiliert und beantwortet mit Claude Code (claude -p) — mit deinem Claude-Login.",
    category: "ai",
    defaultInstalled: false,
    requires: "Claude Code (claude.exe), angemeldet",
    provider: "claude",
  },
  {
    id: "auto-refresh",
    name: "Automatisch lesen",
    description: "Liest die Quellen von selbst — einige Minuten nach dem Start, dann alle 12 Stunden (KNOWLEDGE_EVERY_HOURS) — und kompiliert, was sich geändert hat.",
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
    throw new Error("Mindestens ein KI-Backend bleibt installiert.");
  }
  db().prepare("insert into plugins (id, installed, changed_at) values (?, ?, ?) on conflict(id) do update set installed = excluded.installed, changed_at = excluded.changed_at").run(id, installed ? 1 : 0, new Date().toISOString());
}

/** The AI backends installed — the first is the default. */
export const installedBackends = (): AiBackend[] => KPLUGINS.filter((p) => p.provider && kInstalled(p.id)).map((p) => p.provider!);
