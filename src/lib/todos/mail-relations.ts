import { promptText } from "@/lib/prompts";
import { throwIfAborted } from "@/lib/abort";
import { COPILOT_MAX_PROMPT } from "@/plugins/copilot-cli/cli";
import { t } from "@/lib/i18n/server";
import { getJiraTicket } from "@/lib/jira/store";
import { mailsForTickets } from "@/lib/mail/store";
import { extraBlock, getContextPrefs } from "../runs/context-prefs";
import type { MailView } from "@/lib/mail/shared";
import { plain } from "../runs/collect";
import type { TodoView } from "./shared";
import { listTodos, setTodoMailRefs } from "./store";
import { promptRoom, relateInBatches, relateJob } from "@/lib/ai/batch-job";

/** How many of a ticket's mails the run weighs (the newest) — more than the Ticket-Lage sees. */
/** A prompt's room for tickets, todos and mails (Copilot takes it on the command line). */
const BATCH_CHARS = COPILOT_MAX_PROMPT - 4000;

const SCHEMA = {
  type: "object",
  properties: {
    todos: {
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "integer" }, mails: { type: "array", items: { type: "string" } } },
        required: ["id", "mails"],
      },
    },
  },
  required: ["todos"],
};

export const INSTRUCTIONS = `Du ordnest E-Mails meinen offenen Todos zu. Unten stehen Jira-Tickets, je mit ihren offenen Todos (Nummer in eckigen Klammern) und den Mails aus meinem Posteingang, die das Ticket nennen (Kennung in eckigen Klammern, z. B. [mail:…], dann Datum, Absender, Betreff und die ersten Zeilen, wie Outlooks Liste sie zeigt).

Gib für JEDES Todo die Kennungen der Mails an, die für genau dieses Todo relevant sind: aus denen es folgt, die beantworten oder klären, was es verlangt, oder die man kennen muss, um es zu erledigen (bis zu 8, die aussagekräftigsten). Nach Inhalt, nicht nach Ticket: eine Mail zum selben Ticket über etwas anderes gehört NICHT dazu. Automatische Benachrichtigungen (Jira, GitLab, Systeme) nur, wenn sie für das Todo etwas Bestimmtes sagen (z. B. genau den Kommentar oder die Statusänderung, um die es geht). Passt keine Mail, ist die Liste leer.`;

/** A ticket's block: its summary, its open todos, its mails. */
function block(key: string, todos: TodoView[], mails: MailView[]): string {
  const summary = getJiraTicket(key)?.summary;
  return [
    `## ${key}${summary ? ` — ${plain(summary, 160)}` : ""}`,
    "Offene Todos:",
    ...todos.map((t) => `- [${t.id}] ${plain(t.text, 300)}${t.source ? ` (Quelle: ${plain(t.source, 120)})` : ""}${t.alsoTickets.length ? ` (gehört auch zu ${t.alsoTickets.join(", ")})` : ""}`),
    "Mails:",
    ...mails.map((m) => `- [mail:${m.key}] ${m.receivedAt.slice(0, 16).replace("T", " ")} ${m.fromName ?? m.fromEmail ?? "?"}: „${plain(m.subject, 200)}“ — ${plain(m.preview, 400)}`),
  ].join("\n");
}

export type MailRelationResult = { ok: boolean; todos: number; changed: number; batches: number; error?: string };

/**
 * The mail relation run (after the Ticket-Lage): the AI reads each open todo with the mails that
 * name its ticket(s) and picks, by content, the ones it's about — those become its mail context
 * (todo.mailRefs). In batches of tickets, each its own prompt; one run at a time.
 */
export function relateMails(): Promise<MailRelationResult> {
  return relateJob("__zeffMailRelations", "mail-relations", async () => {
    // Todos on a ticket (those from the Mail-Durchsicht, on none, have their mails already).
    const open = listTodos({ status: "open" }).filter((t) => t.ticket);
    const keys = [...new Set(open.flatMap((t) => [t.ticket, ...t.alsoTickets]))];
    // How far back and how many: the Auswerten settings.
    const { days, perTicket } = getContextPrefs().relations.numbers;
    const byTicket = mailsForTickets(keys, days, perTicket);
    // Per main ticket: its todos and the mails naming it or a ticket linked to it.
    const groups = [...new Set(open.map((t) => t.ticket))].flatMap((key) => {
      const todos = open.filter((t) => t.ticket === key);
      const linked = [...new Set([key, ...todos.flatMap((t) => t.alsoTickets)])];
      const mails = [...new Map(linked.flatMap((k) => byTicket[k] ?? []).map((m) => [m.key, m])).values()]
        .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
        .slice(0, perTicket);
      return [{ key, todos, mails }];
    });
    // Todos without mails to weigh: nothing related.
    const picks = new Map<number, string[]>();
    for (const g of groups) if (!g.mails.length) for (const t of g.todos) picks.set(t.id, []);
    const room = promptRoom(BATCH_CHARS);
    // A batch that fails: its todos keep the mails they have.
    const { batches, failed } = await relateInBatches({
      task: "mail-relations",
      groups: groups.filter((g) => g.mails.length),
      block: (g) => block(g.key, g.todos, g.mails),
      room,
      beforeBatch: throwIfAborted,
      prompt: (blocks) => {
        const instructions = promptText("mail-relations", INSTRUCTIONS) + extraBlock("relations");
        return `${instructions}\n\n${blocks}`.slice(0, room + instructions.length + 200);
      },
      schema: SCHEMA,
      field: "mails",
      take: (g, said) => {
        const known = new Set(g.mails.map((m) => `mail:${m.key}`));
        for (const t of g.todos) {
          // Only mails it was shown (as "mail:<key>", with or without the prefix); unanswered: none.
          const refs = (said.get(t.id) ?? []).map((r) => String(r).trim().replace(/^\[|\]$/g, "")).map((r) => (r.startsWith("mail:") ? r : `mail:${r}`));
          picks.set(t.id, refs.filter((r) => known.has(r)).slice(0, 8));
        }
      },
    });
    const changed = setTodoMailRefs(picks);
    return { todos: picks.size, changed, batches, failed };
  });
}
