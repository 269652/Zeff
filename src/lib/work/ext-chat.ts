/**
 * A kind of chat that an external plugin brings (manifest `contributes.chats`): a live agent in Zeff — like the chat, with its own rules, tools
 * and (if the plugin says so) its conversation kept in a database the person can edit. This is what the built-in Learn's teacher was, as a
 * building block: the rules are a text file of the plugin with `{{name}}` places, filled by one of its functions (the context) each time a
 * session starts; the tools are Zeff's own MCP tools (the plugin's functions are called through `workspace_call_function`); the chat's todo
 * is found by the plugin's own key (a step, a ticket, a customer). Server only.
 */
import fs from "node:fs";
import path from "node:path";
import { getDb, schema } from "@/db";
import { getPref, setPref } from "@/lib/prefs";
import { getPlugin, scanPlugins } from "@/lib/ext/registry";
import { CHAT_ALLOWED_TOOLS, CHAT_DISALLOWED_TOOLS, chatSource, type ChatProfile } from "@/lib/chat";
import { getTodo } from "@/lib/todos/store";
import type { Manifest } from "@/lib/ext/manifest";

export type ChatDecl = Manifest["contributes"]["chats"][number];
export type ExtChat = ChatDecl & { plugin: string; dir: string; kind: string };

/** "ext.<plugin>.<chat>": the chat's kind — the part of its todos' source after "Zeff-Chat:". */
export const extKind = (plugin: string, id: string) => `ext.${plugin}.${id}`;
export const isExtKind = (kind: string) => kind.startsWith("ext.");

/** The chats of the external plugins that are on. */
export function extChats(): ExtChat[] {
  return scanPlugins().plugins.flatMap((p) => (getPlugin(p.id)?.enabled ? p.manifest.contributes.chats.map((c): ExtChat => ({ ...c, plugin: p.id, dir: p.dir, kind: extKind(p.id, c.id) })) : []));
}

/** A chat by "<plugin>.<id>" (how a view names it) or by its kind. */
export const extChat = (name: string): ExtChat | undefined => extChats().find((c) => `${c.plugin}.${c.id}` === name || c.kind === name);

// ---------------------------------------------------------------------------
// Which todo is which chat (by the plugin's own key)
// ---------------------------------------------------------------------------

const LINKS = "workspace.chats.links";
type Links = Record<string, { chat: string; key: string }>;
const links = (): Links => {
  const v = getPref<unknown>(LINKS, {});
  return v && typeof v === "object" ? (v as Links) : {};
};
/** The key a chat's todo was made for (a step's title, a ticket …). */
export const keyOfTodo = (todoId: number): { chat: string; key: string } | null => links()[String(todoId)] ?? null;
export const todoOfKey = (chat: string, key: string): number | null => {
  const hit = Object.entries(links()).find(([id, l]) => l.chat === chat && l.key === key && getTodo(Number(id)));
  return hit ? Number(hit[0]) : null;
};

/** The todo a chat of that key runs on — made once (by a worker: not in your list), found again after. */
export function ensureChatTodo(c: ExtChat, key: string, title: string): number {
  const name = `${c.plugin}.${c.id}`;
  const have = todoOfKey(name, key);
  if (have) return have;
  const now = new Date().toISOString();
  const row = getDb()
    .insert(schema.todos)
    .values({ ticket: "", text: title.slice(0, 200), kind: "other", owner: "me", status: "open", source: chatSource(c.kind), refs: "[]", runId: null, byWorker: true, createdAt: now, updatedAt: now })
    .returning({ id: schema.todos.id })
    .get();
  setPref(LINKS, { ...links(), [String(row.id)]: { chat: name, key } });
  return row.id;
}

// ---------------------------------------------------------------------------
// The agent's rules and tools
// ---------------------------------------------------------------------------

const fill = (template: string, values: Record<string, unknown>): string =>
  template.replace(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g, (_m, name: string) => {
    const v = values[name];
    return v === undefined || v === null ? "" : Array.isArray(v) ? v.map(String).join("\n") : typeof v === "object" ? JSON.stringify(v) : String(v);
  });

/** The rules for a session of this chat: the plugin's text with what its context function says now (a failing function: said, not hidden). */
export async function extRules(c: ExtChat, key: string): Promise<string> {
  let text = "";
  try {
    text = fs.readFileSync(/*turbopackIgnore: true*/ path.join(c.dir, c.rules), "utf8");
  } catch {
    return `You are an agent in Zeff for “${c.title || c.id}”.`;
  }
  let values: Record<string, unknown> = { key };
  if (c.context) {
    try {
      const { runPluginFunction } = await import("@/plugins/workspace/plugin-fn");
      const v = await runPluginFunction(c.plugin, c.context, { key });
      if (v && typeof v === "object" && !Array.isArray(v)) values = { ...values, ...(v as Record<string, unknown>) };
    } catch (e) {
      values = { ...values, contextError: `(The chat's context could not be read: ${e instanceof Error ? e.message : String(e)})` };
    }
  }
  return fill(text, { plugin: c.plugin, chat: `${c.plugin}.${c.id}`, ...values });
}

/** The profile of a session on a chat todo of this plugin's kind (chat.ts asks). */
export async function extProfile(todo: { id: number }, kind: string, preamble: string): Promise<ChatProfile> {
  const c = extChats().find((x) => x.kind === kind);
  const link = keyOfTodo(todo.id);
  if (!c || !link) return { rules: `You are an agent in Zeff.\n\n${preamble}`, allowedTools: CHAT_ALLOWED_TOOLS, disallowedTools: CHAT_DISALLOWED_TOOLS };
  const rules = await extRules(c, link.key);
  return { rules: [rules, preamble].filter((x) => x.trim()).join("\n\n"), allowedTools: [...CHAT_ALLOWED_TOOLS, ...c.tools.map((t) => `mcp__zeff__${t}`)], disallowedTools: CHAT_DISALLOWED_TOOLS };
}
