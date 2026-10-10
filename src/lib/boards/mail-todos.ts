import { and, asc, eq, gte, inArray, isNull } from "drizzle-orm";
import { throwIfAborted } from "@/lib/abort";
import { getDb, schema } from "@/db";
import { aiChoice, runAi } from "@/lib/ai";
import { COPILOT_MAX_PROMPT } from "@/plugins/copilot-cli/cli";
import { errorMessage } from "@/lib/errors";
import { emitChange } from "@/lib/events";
import { getJiraTicket } from "@/lib/jira/store";
import { attributed } from "./activity";
import { plain } from "./collect";
import { dueDay, isTodoKind, TODO_KINDS, type TodoView } from "./shared";
import { extraBlock, getContextPrefs } from "./context-prefs";
import { addFact } from "@/lib/facts";
import { duplicateTodo } from "./similar";
import { addMailTodo, addTodoContext, lastGoodRun, listTodos, setTodoDue, setTodoStatus } from "./store";

const { emails } = schema;

/** A prompt's room for mails (Copilot takes it on the command line). */
const BATCH_CHARS = COPILOT_MAX_PROMPT - 6000;

const SCHEMA = {
  type: "object",
  properties: {
    updates: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "integer" },
          refs: { type: "array", items: { type: "string" } },
          note: { type: "string" },
          done: { type: "boolean" },
          followUps: { type: "array", items: { type: "object", properties: { text: { type: "string" }, due: { type: "string" } }, required: ["text"] } },
          facts: { type: "array", items: { type: "object", properties: { subject: { type: "string" }, text: { type: "string" } }, required: ["subject", "text"] } },
        },
        required: ["id", "refs", "note"],
      },
    },
    facts: {
      type: "array",
      items: {
        type: "object",
        properties: { subject: { type: "string" }, text: { type: "string" }, refs: { type: "array", items: { type: "string" } } },
        required: ["subject", "text", "refs"],
      },
    },
    todos: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          kind: { type: "string", enum: [...TODO_KINDS] },
          owner: { type: "string", enum: ["me", "other"] },
          ticket: { type: "string" },
          due: { type: "string", description: "Frist als JJJJ-MM-TT, wenn die Mail/Nachricht eine nennt — sonst weglassen." },
          refs: { type: "array", items: { type: "string" } },
        },
        required: ["text", "refs"],
      },
    },
  },
  required: ["todos"],
};
type Answer = {
  todos?: { text?: string; kind?: string; owner?: string; ticket?: string; due?: string; refs?: string[] }[];
  updates?: { id?: number; refs?: string[]; note?: string; done?: boolean; followUps?: { text?: string; due?: string }[]; facts?: { subject?: string; text?: string }[] }[];
  facts?: { subject?: string; text?: string; refs?: string[] }[];
};

const INSTRUCTIONS = `Du gehst meine neuen E-Mails durch und findest, was ICH zu tun habe. Unten stehen Mails aus meinem Posteingang (Kennung in eckigen Klammern, z. B. [mail:…], dann Datum, Ordner, Absender, Betreff und die ersten Zeilen, wie Outlooks Liste sie zeigt), meine Tickets und die Todos, die schon offen sind.

Lege für jede Aufgabe, die eine Mail an mich stellt, ein Todo an: ein Satz, Verb zuerst, prüfbar, mit Frist, wenn die Mail eine nennt (die Frist auch als Datum unter due, JJJJ-MM-TT) (z. B. „Compliance-Training ‚Datenschutz 2026‘ bis 31.10. absolvieren“, „Reisekostenabrechnung für September einreichen“, „Termin mit Anna für die Abnahme bestätigen“). Auch Erinnerungen und automatische Mails zählen, wenn sie von mir etwas verlangen (Pflichtschulungen, Fristen, Freigaben, Formulare, Zeiterfassung, Umfragen mit Frist). Zu jedem Todo unter refs die Kennungen der Mails, aus denen es folgt (mehrere Mails zur selben Sache → EIN Todo mit allen). Gehört es zu einem meiner Tickets, gib dessen Schlüssel unter ticket an, sonst lass ticket leer. owner = other nur, wenn ich auf jemand anderen warte.

Einträge im Ordner „WhatsApp“ sind keine Mails, sondern WhatsApp-Chats: der Betreff ist der Chat (Person oder Gruppe), der Text eine Nachricht daraus, der Absender, wer sie schrieb („Ich“ = ich selbst). Die Nachrichten eines Chats stehen zusammen, der Reihe nach — ein Gespräch: eine spätere Antwort von mir kann eine Bitte schon erledigt haben. Auch dort zählt, worum man mich bittet, was ich zugesagt oder offen gelassen habe (z. B. „Eine Uhrzeit mit Natha ausmachen“, „Bei Nadine melden“, „Elmar antworten“ — wenn die letzte Nachricht im Chat eine Frage an mich ist, die ich nicht beantwortet habe) (z. B. „Anna die Fotos vom Samstag schicken“, „Bei Tom wegen Sonntag zurückmelden“) — nicht Smalltalk, Grüße oder Reaktionen.

Trägt eine neue Nachricht etwas zu einem SCHON OFFENEN Todo bei — eine Antwort auf meine Frage, ein Datum, eine Zusage, eine Info, die das Todo braucht (z. B. Karla schreibt „16.10.“ auf meine Frage nach Nadines Geburtstag) —, legst du KEIN neues Todo an, sondern nennst es unter updates: die Nummer des Todos (aus „Schon offene Todos“), die Kennungen der Nachrichten, die dazugehören (auch meine Frage davor), eine kurze Notiz, was neu ist („Karla: Nadines Geburtstag ist am 16.10.“), und done: true nur, wenn das Todo damit wirklich ganz erledigt ist (bleibt ein Teil offen — z. B. das Datum noch eintragen —, done: false). Hat das Todo geplante nächste Schritte („danach geplant: …“), schreib sie NICHT als followUps: ist das Todo selbst erledigt, setz done: true — Zeff legt den nächsten geplanten Schritt dann selbst an (mit der Nachricht und den Fakten als Kontext; eine passende Frist gibst du ihm über followUps mit genau seinem Text und due). Etwas „festhalten“, „notieren“ oder „eintragen“ (ein Datum, eine Info) ist erledigt, sobald du es unter facts angibst — dafür kein eigenes Todo. Folgt daraus darüber hinaus etwas Neues zu tun, gib es unter followUps an (ein Satz, Verb zuerst, mit Frist due JJJJ-MM-TT, wenn eine naheliegt — z. B. nach „Nadines Geburtstag ist am 16.10.“: „Nadine ein Geschenk besorgen“, due ein paar Tage vorher). Steht in der Nachricht etwas Dauerhaftes, das man sich merken sollte — ein Geburtstag, eine Adresse, eine Telefonnummer (keine Passwörter oder Zugangsdaten), eine Vorliebe, eine Abmachung —, gib es unter facts an: subject kurz und eindeutig („Nadines Geburtstag“), text die Tatsache („16.10.“).

Auch ohne Todo: Steht in einer Nachricht so etwas Dauerhaftes, gib es oben unter facts an (subject, text, refs der Nachrichten).

KEINE Todos für: Newsletter, Werbung, reine Info ohne Handlung, Benachrichtigungen über Jira-/GitLab-Kommentare und Statuswechsel (die kennt die Ticket-Lage schon), Lesebestätigungen, Termine, die nur informieren — und nichts, was ein schon offenes Todo abdeckt oder schon erledigt ist (z. B. eine spätere Mail bestätigt es). Gibt es nichts zu tun, ist die Liste leer.`;

const state = globalThis as unknown as { __zeffMailTodos?: Promise<MailTodosResult> | null };
export type MailTodosResult = { ok: boolean; reviewed: number; added: number; updated?: number; batches: number; error?: string };

/** A ticket key in a mail's subject or lines (one of the tickets the Lage reads — it has those mails). */
const namesTicket = (keys: string[], text: string) => keys.some((k) => new RegExp(`(^|[^A-Za-z0-9])${k}(?![0-9])`, "i").test(text));

/**
 * The Mail-Durchsicht (after the Ticket-Lage, before the Mail-Zuordnung): the AI goes through the
 * mails not gone through yet (the last two weeks; those naming a Lage ticket are the Lage's) and
 * makes todos of what they ask of you — a compliance training, a form, a deadline. Each mail is
 * gone through once. In batches, each its own prompt; one at a time.
 */
export function reviewMailsForTodos(runId: number | null = null): Promise<MailTodosResult> {
  if (state.__zeffMailTodos) return state.__zeffMailTodos;
  const run = (async (): Promise<MailTodosResult> => {
    // How far back, and which: the Auswerten settings (a source switched off: its messages wait, not gone through).
    const cp = getContextPrefs().mailtodos;
    const since = new Date(Date.now() - cp.numbers.days * 864e5).toISOString();
    // A WhatsApp chat whose last message isn't yours waits for your answer — gone through further
    // back (it may be weeks old: "Elmar antworten").
    const chatSince = new Date(Date.now() - Math.max(cp.numbers.days, cp.numbers.chatDays) * 864e5).toISOString();
    const lastOf = new Map<string, string | null>();
    if (cp.sources.whatsapp)
      for (const m of getDb()
        .select({ convId: emails.convId, fromName: emails.fromName, receivedAt: emails.receivedAt })
        .from(emails)
        .where(and(eq(emails.folder, "WhatsApp"), gte(emails.receivedAt, chatSince)))
        .orderBy(asc(emails.receivedAt))
        .all())
        lastOf.set(m.convId, m.fromName);
    const unanswered = (convId: string) => lastOf.has(convId) && lastOf.get(convId) !== "Ich";
    const rows = getDb()
      .select()
      .from(emails)
      .where(and(isNull(emails.reviewedAt), isNull(emails.resolvedAt), gte(emails.receivedAt, chatSince)))
      .orderBy(asc(emails.receivedAt))
      .all()
      .filter((m) => (m.folder === "WhatsApp" ? cp.sources.whatsapp && (m.receivedAt >= since || unanswered(m.convId)) : cp.sources.mail && m.receivedAt >= since))
      // The chat list's unread badge, read as a message once ("5 ungelesene Nachrichten"): not one.
      .filter((m) => !(m.folder === "WhatsApp" && /^\d+ (ungelesene Nachricht|unread message)/i.test(m.preview)));
    const markReviewed = (keys: string[]) => {
      if (keys.length) getDb().update(emails).set({ reviewedAt: new Date().toISOString() }).where(inArray(emails.key, keys)).run();
    };
    const tickets = lastGoodRun()?.tickets.map((t) => t.key) ?? [];
    const cited = new Set(listTodos({ status: "all" }).flatMap((t) => t.refs.filter((r) => r.startsWith("mail:")).map((r) => r.slice(5))));
    // The Lage's (they name its tickets) and those a todo has already: gone through.
    const theirs = rows.filter((m) => cited.has(m.key) || namesTicket(tickets, `${m.subject} ${m.preview}`));
    markReviewed(theirs.map((m) => m.key));
    // A WhatsApp chat's messages together, in order (a conversation — your reply after a request
    // tells it's settled); the mails by time.
    const chatOf = (m: (typeof rows)[number]) => (m.folder === "WhatsApp" ? m.convId : "");
    const mails = rows.filter((m) => !theirs.includes(m)).sort((a, b) => chatOf(a).localeCompare(chatOf(b)) || a.receivedAt.localeCompare(b.receivedAt));
    if (!mails.length) return { ok: true, reviewed: theirs.length, added: 0, batches: 0 };

    const ticketLines = tickets.map((k) => `- ${k}${getJiraTicket(k)?.summary ? ` — ${plain(getJiraTicket(k)!.summary, 120)}` : ""}`);
    const line = (m: (typeof mails)[number]) =>
      `- [mail:${m.key}] ${m.receivedAt.slice(0, 16).replace("T", " ")} (${m.folder}) ${m.fromName ?? m.fromEmail ?? "?"}: „${plain(m.subject, 200)}“ — ${plain(m.preview, 400)}`;
    const limit = aiChoice().provider === "copilot" ? BATCH_CHARS : 3 * BATCH_CHARS;
    const batches: (typeof mails)[] = [];
    let size = 0;
    for (const m of mails) {
      const n = line(m).length + 1;
      if (!batches.length || size + n > limit) {
        batches.push([]);
        size = 0;
      }
      batches[batches.length - 1].push(m);
      size += n;
    }

    let added = 0;
    let updated = 0;
    let failed = 0;
    let reviewed = theirs.length;
    for (const batch of batches) {
      throwIfAborted();
      const open = listTodos({ status: "open" });
      const prompt = [
        INSTRUCTIONS + extraBlock("mailtodos"),
        "",
        `Heute ist ${new Date().toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric" })} (${new Date().toISOString().slice(0, 10)}).`,
        "",
        "# Meine Tickets",
        ...(ticketLines.length ? ticketLines : ["(keine)"]),
        "",
        "# Schon offene Todos",
        ...open.slice(0, 60).map((t) => {
          const next = t.planned[0]?.steps.map((s) => `„${plain(s.text, 80)}“`).join(" → ");
          return `- [${t.id}]${t.ticket ? ` ${t.ticket}` : ""}: ${plain(t.text, 160)}${next ? ` — danach geplant: ${next}` : ""}`;
        }),
        "",
        "# Mails",
        ...batch.map(line),
      ].join("\n");
      const answer = await runAi<Answer>(prompt, SCHEMA, { task: "mail-todos", timeoutMs: 10 * 60000, maxBudgetUsd: 1 }).catch((e) => {
        console.error("[mail-todos]", errorMessage(e));
        failed++;
        return null;
      });
      // A batch that fails: its mails are gone through next time.
      if (!answer) continue;
      const known = new Set(batch.map((m) => `mail:${m.key}`));
      // What new messages add to todos already open: their context, a note — done, if they settle it.
      for (const u of answer.output?.updates ?? []) {
        const todo = open.find((t) => t.id === Number(u.id));
        const refs = (u.refs ?? []).map((r) => String(r).trim().replace(/^\[|\]$/g, "")).map((r) => (r.startsWith("mail:") ? r : `mail:${r}`)).filter((r) => known.has(r));
        if (!todo || !refs.length) continue;
        // Facts it brings: kept as knowledge, linked to this todo and its follow-ups.
        const factRefs = (u.facts ?? []).flatMap((f) => {
          const x = addFact({ subject: f.subject ?? "", text: f.text ?? "", refs });
          return x ? [x.ref] : [];
        });
        addTodoContext(todo.id, [...refs, ...factRefs], u.note ?? "", "Mail-Durchsicht");
        // Done: its planned steps come next (afterDone) — with the messages and facts as their context.
        let next: TodoView[] = [];
        if (u.done && todo.status === "open") {
          setTodoStatus(todo.id, "done", (u.note ?? "").slice(0, 500) || "Laut neuer Nachricht erledigt.");
          next = listTodos({ status: "open" }).filter((t) => t.parentId === todo.id);
          for (const n of next) {
            addTodoContext(n.id, [...refs, ...factRefs], "", "Mail-Durchsicht");
            open.push(n);
          }
        }
        // What follows from it: todos of their own (on its ticket), with the facts they need — a
        // planned step already there takes its deadline instead of a second todo.
        for (const f of u.followUps ?? []) {
          const text = f.text?.trim();
          if (!text) continue;
          const planned = duplicateTodo({ text, ops: [] }, next);
          if (planned) {
            if (dueDay(f.due)) setTodoDue(planned.id, f.due!);
            continue;
          }
          if (duplicateTodo({ text, ops: [] }, open)) continue;
          const t = attributed(runId ? `lage:${runId}` : "mail", () =>
            addMailTodo({ ticket: todo.ticket, text, kind: "other", owner: "me", refs: [...refs, ...factRefs], runId, due: f.due ?? null }),
          );
          open.push(t);
          added++;
        }
        updated++;
      }
      // Facts worth keeping, without a todo (a birthday, an address): knowledge of their own.
      for (const f of answer.output?.facts ?? []) {
        const refs = (f.refs ?? []).map((r) => String(r).trim().replace(/^\[|\]$/g, "")).map((r) => (r.startsWith("mail:") ? r : `mail:${r}`)).filter((r) => known.has(r));
        if (refs.length) addFact({ subject: f.subject ?? "", text: f.text ?? "", refs });
      }
      for (const td of answer.output?.todos ?? []) {
        const text = td.text?.trim();
        const refs = (td.refs ?? []).map((r) => String(r).trim().replace(/^\[|\]$/g, "")).map((r) => (r.startsWith("mail:") ? r : `mail:${r}`)).filter((r) => known.has(r));
        if (!text || !refs.length) continue;
        const ticket = td.ticket?.trim().toUpperCase() ?? "";
        if (duplicateTodo({ text, ops: [] }, open)) continue;
        const t = attributed(runId ? `lage:${runId}` : "mail", () =>
          addMailTodo({ ticket: tickets.includes(ticket) ? ticket : "", text, kind: isTodoKind(td.kind) ? td.kind : "other", owner: td.owner === "other" ? "other" : "me", refs, runId, due: td.due ?? null }),
        );
        open.push(t);
        added++;
      }
      markReviewed(batch.map((m) => m.key));
      reviewed += batch.length;
    }
    if (added || updated) emitChange("todos");
    return {
      ok: failed < batches.length,
      reviewed,
      added,
      updated,
      batches: batches.length,
      ...(failed ? { error: `${failed} von ${batches.length} Teilen fehlgeschlagen` } : {}),
    };
  })()
    .catch((e): MailTodosResult => {
      console.error("[mail-todos]", errorMessage(e));
      return { ok: false, reviewed: 0, added: 0, batches: 0, error: errorMessage(e) };
    })
    .finally(() => {
      state.__zeffMailTodos = null;
    });
  state.__zeffMailTodos = run;
  return run;
}
