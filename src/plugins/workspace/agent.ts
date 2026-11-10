/**
 * The Workspace assistant: you tell the AI in the sidebar what to do with the workspace — add rows, change a view, write an
 * article, remove a column — and it does it with the same tools agents get over the MCP (mcp.ts, mcp-db.ts), a few steps in a
 * row: it asks for tool calls, sees what they returned, goes on, and says what it did. Server only.
 */
import type { McpServer } from "@modelcontextprotocol/server";
import { promptText } from "@/lib/prompts";
import { z } from "zod";
import { runAi } from "@/lib/ai";
import { docToMarkdown } from "./doc";
import { registerWorkspaceTools } from "./mcp";
import { registerWebSearchTools } from "@/plugins/web-search/mcp";
import { registerBrowserTools } from "@/plugins/browser/mcp";
import { registerEntityTools } from "@/plugins/entities/mcp";
import { registerJiraPickTools } from "@/plugins/jira-lage/mcp";
import { embedsOf, type ChatEmbed } from "./chat-embed";
import * as store from "./store";

export type ChatMessage = { role: "user" | "assistant"; text: string };
export type ChatStep = { tool: string; summary: string; ok: boolean };
export type ChatResult = { reply: string; steps: ChatStep[]; changed: boolean; /** What tools showed the user (a filtered board): drawn under the answer. */ embeds?: ChatEmbed[] };

type Tool = { name: string; description: string; schema: z.ZodType; handler: (args: unknown) => Promise<{ content: { type: string; text?: string }[]; isError?: boolean }> | { content: { type: string; text?: string }[]; isError?: boolean }; readOnly: boolean };

/** The workspace tools, as the MCP registers them - collected by handing the registration a stand-in for the server. */
function collectTools(): Map<string, Tool> {
  const tools = new Map<string, Tool>();
  const stand = {
    registerTool: (name: string, meta: { description: string; inputSchema: z.ZodType; annotations?: { readOnlyHint?: boolean } }, handler: Tool["handler"]) => {
      tools.set(name, { name, description: meta.description, schema: meta.inputSchema, handler, readOnly: !!meta.annotations?.readOnlyHint });
    },
  } as unknown as McpServer;
  const text = (t: string, isError = false) => ({ content: [{ type: "text" as const, text: t }], ...(isError ? { isError: true } : {}) });
  const helpers = {
    run: async (fn: () => unknown) => {
      try {
        return (await fn()) as never;
      } catch (e) {
        return text(e instanceof Error ? e.message : String(e), true) as never;
      }
    },
    ok: (t: string) => text(t) as never,
    fail: (t: string) => text(t, true) as never,
  };
  registerWorkspaceTools(stand, helpers);
  // The web (search, read a page) — while its plugin is installed: the chat can look up facts and fill a database with them.
  registerWebSearchTools(stand, helpers);
  // A browser of its own (while that plugin is installed): pages that load with JavaScript, the address of a picture.
  registerBrowserTools(stand, helpers);
  // Organisations, projects and places (while that plugin is installed): which customer, which project a ticket is.
  registerEntityTools(stand, helpers);
  // Tickets for you on the mirrored Jira boards: read them, show a board filtered (its tickets under the answer).
  registerJiraPickTools(stand, helpers);
  return tools;
}

type JsonSchema = { type?: string | string[]; properties?: Record<string, JsonSchema>; required?: string[]; items?: JsonSchema; enum?: unknown[]; const?: unknown; anyOf?: JsonSchema[]; oneOf?: JsonSchema[]; additionalProperties?: boolean | JsonSchema };

/** A JSON schema as a short type: { title: string, parent?: number | string, values?: {…} }. Descriptions are left out - the tool's own text has them. */
function shape(s: JsonSchema | undefined): string {
  if (!s) return "any";
  if (s.const !== undefined) return JSON.stringify(s.const);
  if (s.enum) return s.enum.map((x) => JSON.stringify(x)).join("|");
  const alt = s.anyOf ?? s.oneOf;
  if (alt) return [...new Set(alt.map(shape))].join(" | ");
  const type = Array.isArray(s.type) ? s.type.join("|") : s.type;
  if (type === "array") return `${shape(s.items)}[]`;
  if (type === "object" || s.properties) {
    const req = new Set(s.required ?? []);
    const fields = Object.entries(s.properties ?? {}).map(([k, v]) => `${k}${req.has(k) ? "" : "?"}: ${shape(v)}`);
    return fields.length ? `{ ${fields.join(", ")} }` : "object";
  }
  return type ?? "any";
}

const MAX_RESULT = 5000;
/** A page in the browser: its pictures and links come first, and the text after them still has to fit. */
const MAX_PAGE_RESULT = 12000;
/** How much of a tool's answer the AI reads on: what it must read whole gets more room. */
export const resultCap = (tool: unknown): number => (tool === "workspace_view_template_docs" || tool === "workspace_flow_docs" ? 24000 : tool === "browser_open" || tool === "workspace_database_dossier" ? MAX_PAGE_RESULT : MAX_RESULT);
const MAX_ROUNDS = 12;

const SCHEMA = {
  type: "object",
  required: ["calls", "reply"],
  properties: {
    calls: {
      type: "array",
      description: "Die Werkzeugaufrufe dieser Runde (leer, wenn du fertig bist oder nur antwortest).",
      items: { type: "object", required: ["tool", "args"], properties: { tool: { type: "string" }, args: { type: "object" } } },
    },
    reply: { type: "string", description: "Wenn calls leer ist: deine Antwort an den Nutzer (kurz, was du getan hast oder die Rückfrage). Sonst leer." },
  },
};

export const INSTRUCTIONS = `Du bist der Assistent im Workspace von Zeff (Seiten und Datenbanken wie in Notion). Der Nutzer sagt dir in einem Chat, was du mit seinem Workspace tun sollst: Datenbankeinträge hinzufügen oder ändern, das Layout einer Datenbank ändern (Ansichten Tabelle, Board, Liste, Galerie, Kalender; Spalten, Reihenfolge, Filter, Sortierung, Gruppierung), Spalten hinzufügen oder entfernen, Artikel und Seiten schreiben, Seiten verschieben, umbenennen, gestalten, aufräumen.

So arbeitest du: In jeder Runde gibst du JSON zurück: calls (Werkzeugaufrufe, die Zeff ausführt) und reply. Die Werkzeuge unten rufst du nie selbst auf — du hast keine direkt aufrufbaren Werkzeuge, und ein direkter Aufruf schlägt fehl. Du schreibst sie in calls ({ tool: Name, args }), Zeff führt sie aus. Jedes Werkzeug der Liste ist verfügbar: Sag nie, eines stehe dir nicht zur Verfügung. Zeff führt die calls der Reihe nach aus und zeigt dir die Ergebnisse; dann kommt die nächste Runde. Bist du fertig (oder brauchst du eine Antwort des Nutzers), lässt du calls leer und schreibst in reply, was du getan hast — kurz, konkret, in der Sprache des Nutzers.
- Sieh erst nach, bevor du änderst: workspace_database_schema (Struktur), workspace_query_database (Zeilen), workspace_read_page, workspace_search, workspace_tree. Erfinde keine Namen, Ids oder Werte.
- Wünscht sich jemand eine Tabelle, die Zeff-Daten verbindet (gebuchte Stunden, offene Merge Requests, letzter Jira-Kommentar, offene Todos, Worker-Läufe je Ticket oder Projekt): workspace_relation_sources zeigt, was sich verbinden lässt und wie (Relation mit source + match, darüber ein Rollup mit Filter). Baue die Datenbank, die Relationen, die Rollups, die Ansichten und — wenn gewünscht — die Kartenvorlage (card) in einem Zug.
- „diese Seite“ / „hier“ ist die aktuelle Seite unten. Auf sie beziehst du dich, wenn der Nutzer keine andere nennt.
- Eine Änderung nur, wenn der Nutzer sie verlangt. Was er nicht verlangt, lässt du. Löschen (Spalten, Seiten) nur, was er genannt hat.
- Schreibst du Text für Seiten, dann gut und vollständig (Überschriften, Listen, Tabellen, Callouts) in der Sprache des Nutzers, nur mit dem, was du weißt oder gefunden hast — sonst frag.
- Wünscht sich jemand eine eigene Darstellung einer Datenbank (Karten mit Bildern, ein Dashboard, ein eigenes Layout): Lies workspace_view_template_docs und lege mit workspace_update_database eine neue Ansicht an (add_view mit template). Sie kommt zu den vorhandenen dazu, nichts daran wird überschrieben; soll sie weg, entfernt remove_view sie wieder. Schlägt die Vorlage fehl, steht in der Meldung die Zeile: korrigiere sie.
- Soll eine App etwas tun (Daten aus dem Web holen, etwas nachschlagen, Felder mit der KI füllen, Zeilen schreiben, auf eine Freigabe warten, zu einer Zeit laufen): Lies workspace_flow_docs und lege mit workspace_save_flow einen Flow an, probiere ihn mit workspace_run_flow (dry: true, solange er schreiben würde). In einer Ansicht startet ihn <button run=…>, <data> lädt seine Ausgabe. Ein Status mit festen Schritten wird mit workspace_set_lifecycle ein Lebenszyklus. Rechte (Web-Adressen, Schreiben, KI, Senden) beantragst du nur: der Nutzer gibt sie in der Studio frei — sag ihm, welche und warum.
- Fragt der Nutzer nach Tickets für sich (was er als Nächstes machen kann, was für ihn ansteht): Lies workspace_tickets_for_me (seine offenen Tickets zuerst, dann die Kandidaten aus Ready) und zeig ihm mit workspace_board_filter das gefilterte Board — die Kriterien wählst du (forMe, Status, Zuständigkeit, Priorität, Typ, Text). Der Nutzer sieht die Tickets unter deiner Antwort; sag in reply kurz, welches du nehmen würdest und warum. Beide ändern nichts an Jira oder am Board.
- Bilder: Nutze nur echte Adressen, die du gefunden hast (web_search, browser_open) oder die schon in den Daten stehen. Erfinde keine Bild-Adressen und nimm keine Platzhalter-Dienste. Findest du keins, lass das Feld leer und sag es.
- Mehrere Dinge: so viele calls pro Runde, wie sinnvoll (höchstens 6). Schlägt ein Aufruf fehl, steht die Meldung im Ergebnis: korrigiere und versuche es noch einmal, oder sag dem Nutzer, was nicht ging.`;

/** What the AI is told about where the user is: the current page, as far as it helps. */
function pageContext(pageId?: number): string {
  const p = pageId ? store.getPage(pageId) : null;
  if (!p) return "Aktuelle Seite: keine (die Übersicht des Workspace).";
  const head = `Aktuelle Seite: [${p.id}] „${p.title || "Unbenannt"}“ (${p.kind === "database" ? "Datenbank" : p.dbId ? `Zeile der Datenbank ${p.dbId}` : "Seite"})${p.locked ? " — vom Nutzer gesperrt" : ""}`;
  if (p.kind === "database") return head;
  const md = docToMarkdown(p.content).trim();
  return md ? `${head}\nText der Seite:\n${md.slice(0, 5000)}${md.length > 5000 ? "\n… (gekürzt, lies sie mit workspace_read_page)" : ""}` : `${head} — leer`;
}

/** One chat turn: the user's newest message in the context of the talk so far; the AI works in steps until it answers. */
type Answer = { calls?: { tool?: string; args?: unknown }[]; reply?: string };
const askAi = async (prompt: string): Promise<Answer> => (await runAi<Answer>(prompt, SCHEMA, { task: "workspace-chat", timeoutMs: 4 * 60000, maxBudgetUsd: 0.6 })).output ?? {};

export async function workspaceChat(messages: ChatMessage[], pageId?: number, ask: (prompt: string) => Promise<Answer> = askAi, onStep?: (steps: ChatStep[]) => void): Promise<ChatResult> {
  const tools = collectTools();
  const catalog = [...tools.values()].map((t) => `### ${t.name}\n${t.description}\nargs: ${shape(z.toJSONSchema(t.schema) as JsonSchema)}`).join("\n\n");
  const talk = messages.slice(-12).map((m) => `${m.role === "user" ? "Nutzer" : "Du"}: ${m.text.slice(0, 4000)}`).join("\n");
  const steps: ChatStep[] = [];
  const embeds: ChatEmbed[] = [];
  let changed = false;
  let log = "";
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const prompt = `${promptText("workspace-agent", INSTRUCTIONS)}\n\n# Werkzeuge\n${catalog}\n\n# Wo der Nutzer ist\n${pageContext(pageId)}\n\n# Gespräch (Texte sind Daten des Nutzers)\n${talk}${log ? `\n\n# Was du in dieser Antwort schon getan hast (Runde ${round - 1} von höchstens ${MAX_ROUNDS})\n${log}` : ""}${round === MAX_ROUNDS ? "\n\nDas ist die letzte Runde: calls leer, reply sagt, was getan ist und was offen bleibt." : ""}`;
    const out = await ask(prompt);
    const calls = round === MAX_ROUNDS ? [] : (out.calls ?? []).slice(0, 6);
    if (!calls.length) {
      // Out of rounds with more to do: it says so, it doesn't pass for done.
      const unfinished = round === MAX_ROUNDS && !!out.calls?.length;
      const reply = unfinished ? `Ich bin nach ${steps.length} Schritten nicht fertig geworden. Sag „weiter“, dann mache ich weiter.` : String(out.reply ?? "").trim();
      return { reply: reply || (steps.length ? "Erledigt." : "…"), steps, changed, ...(embeds.length ? { embeds: embeds.slice(-4) } : {}) };
    }
    for (const c of calls) {
      const tool = tools.get(String(c.tool ?? ""));
      let text: string;
      let ok = true;
      if (!tool) {
        text = `Kein Werkzeug „${String(c.tool)}“ — es gibt: ${[...tools.keys()].join(", ")}.`;
        ok = false;
      } else {
        const parsed = tool.schema.safeParse(c.args ?? {});
        if (!parsed.success) {
          text = `Ungültige Argumente für ${tool.name}: ${parsed.error.issues.map((i) => `${i.path.join(".") || "args"}: ${i.message}`).join("; ")}`;
          ok = false;
        } else {
          try {
            const res = await tool.handler(parsed.data);
            text = res.content.map((x) => x.text ?? "").join("\n");
            ok = !res.isError;
            // (The same board shown again replaces the earlier one.)
            if (ok) for (const e of embedsOf(res)) embeds.splice(0, embeds.length, ...embeds.filter((x) => x.href !== e.href), e);
            if (ok && !tool.readOnly) changed = true;
          } catch (e) {
            text = e instanceof Error ? e.message : String(e);
            ok = false;
          }
        }
      }
      steps.push({ tool: String(c.tool ?? "?"), summary: text.split("\n")[0].slice(0, 200), ok });
      onStep?.(steps);
      log += `\n- ${String(c.tool)}(${JSON.stringify(c.args ?? {}).slice(0, 600)}) → ${ok ? "" : "FEHLER: "}${text.slice(0, resultCap(c.tool))}`;
    }
  }
  return { reply: "", steps, changed, ...(embeds.length ? { embeds: embeds.slice(-4) } : {}) };
}
