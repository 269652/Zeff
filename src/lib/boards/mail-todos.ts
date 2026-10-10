import { and, asc, desc, gte, inArray, isNull, sql } from "drizzle-orm";
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
import { getPref, setPref } from "@/lib/prefs";
import { duplicateTodo } from "./similar";
import { addMailTodo, addTodoContext, droppedByYou, lastGoodRun, listTodos, setTodoDue, setTodoStatus } from "./store";
import { isInstalled } from "@/plugins/state";

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

Lege für jede Aufgabe, die eine Mail an mich stellt, ein Todo an: ein Satz, Verb zuerst, prüfbar, mit Frist, wenn die Mail eine nennt (die Frist auch als Datum unter due, JJJJ-MM-TT) (z. B. „Compliance-Training ‚Datenschutz 2026‘ bis 31.10. absolvieren“, „Reisekostenabrechnung für September einreichen“, „Termin mit Anna für die Abnahme bestätigen“). Auch Erinnerungen und automatische Mails zählen, wenn sie von mir etwas verlangen (Pflichtschulungen, Fristen, Freigaben, Signaturen, Formulare, Zeiterfassung, Umfragen mit Frist). Zu jedem Todo unter refs die Kennungen der Mails, aus denen es folgt (mehrere Mails zur selben Sache → EIN Todo mit allen). Gehört es zu einem meiner Tickets, gib dessen Schlüssel unter ticket an, sonst lass ticket leer. owner = other nur, wenn ich auf jemand anderen warte.

Einträge im Ordner „WhatsApp“ sind keine Mails, sondern WhatsApp-Chats: der Betreff ist der Chat (Person oder Gruppe), der Text eine Nachricht daraus, der Absender, wer sie schrieb („Ich“ = ich selbst). Die Nachrichten eines Chats stehen zusammen, der Reihe nach — ein Gespräch: eine spätere Antwort von mir kann eine Bitte schon erledigt haben. Auch dort zählt, worum man mich bittet, was ich zugesagt oder offen gelassen habe (z. B. „Mit Tom eine Uhrzeit ausmachen“, „Bei Lisa melden“, „Ben antworten“ — wenn die letzte Nachricht im Chat eine Frage an mich ist, die ich nicht beantwortet habe) (z. B. „Anna die Fotos vom Samstag schicken“, „Bei Tom wegen Sonntag zurückmelden“) — nicht Smalltalk, Grüße oder Reaktionen.

Trägt eine neue Nachricht etwas zu einem SCHON OFFENEN Todo bei — eine Antwort auf meine Frage, ein Datum, eine Zusage, eine Info, die das Todo braucht (z. B. Lisa schreibt „3.5.“ auf meine Frage nach Toms Geburtstag) —, legst du KEIN neues Todo an, sondern nennst es unter updates: die Nummer des Todos (aus „Schon offene Todos“), die Kennungen der Nachrichten, die dazugehören (auch meine Frage davor), eine kurze Notiz, was neu ist („Lisa: Toms Geburtstag ist am 3.5.“), und done: true nur, wenn das Todo damit wirklich ganz erledigt ist (bleibt ein Teil offen — z. B. das Datum noch eintragen —, done: false). Hat das Todo geplante nächste Schritte („danach geplant: …“), schreib sie NICHT als followUps: ist das Todo selbst erledigt, setz done: true — Zeff legt den nächsten geplanten Schritt dann selbst an (mit der Nachricht und den Fakten als Kontext; eine passende Frist gibst du ihm über followUps mit genau seinem Text und due). Etwas „festhalten“, „notieren“ oder „eintragen“ (ein Datum, eine Info) ist erledigt, sobald du es unter facts angibst — dafür kein eigenes Todo. Folgt daraus darüber hinaus etwas Neues zu tun, gib es unter followUps an (ein Satz, Verb zuerst, mit Frist due JJJJ-MM-TT, wenn eine naheliegt — z. B. nach „Toms Geburtstag ist am 3.5.“: „Tom ein Geschenk besorgen“, due ein paar Tage vorher). Steht in der Nachricht etwas Dauerhaftes, das man sich merken sollte — ein Geburtstag, eine Adresse, eine Telefonnummer (keine Passwörter oder Zugangsdaten), eine Vorliebe, eine Abmachung —, gib es unter facts an: subject kurz und eindeutig („Toms Geburtstag“), text die Tatsache („3.5.“).

Auch ohne Todo: Steht in einer Nachricht so etwas Dauerhaftes, gib es oben unter facts an (subject, text, refs der Nachrichten).

Unter „Ruhende Unterhaltungen“ stehen Gespräche, an denen ich beteiligt war und die seit Tagen still sind — mit ihrem Verlauf und dem, was seitdem zum Thema passiert ist. Beurteile jede für sich, in zwei unabhängigen Fragen:
1. Was ist darin offen geblieben? Ein gemeldetes Problem ohne Lösung, eine Frage ohne Antwort, eine Zusage von mir, ein vereinbarter nächster Schritt → je ein Todo (z. B. „Bei Anna nachfragen, ob der Drucker wieder läuft“).
2. Gibt es Neues zum Thema, das die andere Seite wissen sollte? Such es selbst: in den „Aktuellen Unterhaltungen“, den neuen Nachrichten und meinen offenen Todos — dasselbe Thema auch unter anderen Worten oder mit anderen Leuten (z. B. „Vereinsfest“ mit Anna ↔ „Sommerfeier Planung“ mit Ben: dasselbe Fest). Ein Termin hat stattgefunden, jemand anderes arbeitet daran, ein Problem ist gelöst → ein eigenes Todo, sie auf den Stand zu bringen (z. B. „Anna Bescheid geben, dass Ben und ich die Sommerfeier planen“). Die „Stichwort-Treffer“ sind nur ein Hinweis, keine Grenze.
Jeweils mit der Kennung der Unterhaltung (und der Nachrichten von „Seitdem zum Thema“, auf die es sich stützt) unter refs. Ist nichts offen und nichts neu, nichts.

Mit „⚠ PFLICHT“ markierte Mails (Zeff erkennt sie: Pflichtschulungen, Compliance-Trainings, Signaturen) ergeben IMMER ein Todo — je Schulung bzw. Dokument ein eigenes, auch wenn die Frist schon abgelaufen ist (dann erst recht, „überfällig“ im Text), auch bei der x-ten Erinnerung, und auch, wenn Ähnliches unter „Was ich verworfen habe“ steht. Erkennst du selbst eine Pflichtschulung oder eine andere Pflicht ohne Markierung: ebenso.

KEINE Todos für: Newsletter, Werbung, reine Info ohne Handlung, Benachrichtigungen über Jira-/GitLab-Kommentare, Merge Requests und Statuswechsel (die kennt die Ticket-Lage schon — auch wenn darin jemand etwas von mir will), Lesebestätigungen, Abwesenheitsnotizen und andere automatische Antworten, Termine, die nur informieren — und nichts, was ein schon offenes Todo abdeckt oder schon erledigt ist (z. B. eine spätere Mail bestätigt es).
Auch KEINE Todos für: ausdrücklich freiwillige Umfragen und Aufrufe zur Teilnahme (ohne Pflicht und ohne Frist) und Werbung von Firmen und Diensten für ihr Angebot (neue Funktionen, Angebote). Verlangt ein Dienst dagegen etwas mit Frist oder droht ein Nachteil (ein Konto wird gesperrt oder gelöscht, eine Karte wird ersetzt, Angaben fehlen), ist das ein Todo — ob ich den Dienst noch nutze, entscheide ich.

Unter „Was ich verworfen habe“ stehen Vorschläge, die ich nicht wollte (mit der Mail, aus der sie kamen): dieselbe Art Mail vom SELBEN Absender ist wieder kein Todo. Mehr schließt du daraus nicht — andere Absender, Pflicht-Mails (⚠) und Menschen beurteilst du wie immer. Unter „Was ich erledigt habe“ stehen Vorschläge, die richtig waren: solche will ich. Fragt mich ein Mensch persönlich etwas, bittet mich um etwas oder wartet auf meine Antwort (in einer Mail oder einem Chat), ist das fast immer ein Todo — das sind die wichtigsten. Im Zweifel legst du das Todo an: ein überflüssiger Vorschlag ist schnell verworfen, eine vergessene Pflicht oder Antwort nicht. Gibt es nichts zu tun, ist die Liste leer.`;

const state = globalThis as unknown as { __zeffMailTodos?: Promise<MailTodosResult> | null };
export type MailTodosResult = { ok: boolean; reviewed: number; added: number; updated?: number; batches: number; error?: string };

/** Words too common to tell a topic by (German, English, mail and chat filler). */
const STOP = new Set(
  "aber alle allem also auch auf aus bei beim bin bis bitte dann dass dein deine dem den denn der des dich dir doch dort du durch eine einem einen einer eines euch für gerade gibt habe haben hallo hast hatte heute hier ich ihr ihre immer ist jetzt kann kannst kein keine klar komme kommt können lieber liebe mach machen mal mehr mein meine mich mir mit morgen muss nach nachricht nicht noch nur oder schon sehr sein seine sich sie sind soll über uns unter viel viele vielen vom von vor wann war waren warum was weil wenn wer werde wie wieder wir wird woche wollte würde zum zur zwar gesendet outlook iphone android grüße gruß danke dank thanks hello regards sent from with this that have will your would about there their what when which aw re fwd wg antw gmail mail mails".split(" "),
);
const wordsOf = (text: string) =>
  [...new Set((text.toLowerCase().match(/[a-zäöüß0-9][a-zäöüß0-9-]{3,}/g) ?? []).filter((w) => !STOP.has(w) && !/^\d+$/.test(w)))].slice(0, 25);

/**
 * A quiet conversation's last messages (both sides), and what happened on its topic since its last
 * one — other conversations' messages and your todos that share its words (newest first).
 */
export function sinceOnTopic(m: typeof emails.$inferSelect): { thread: (typeof emails.$inferSelect)[]; since: string[] } {
  const thread = getDb().select().from(emails).where(sql`${emails.convId} = ${m.convId}`).orderBy(desc(emails.receivedAt)).limit(10).all().reverse();
  // Its topic: the words of its subject (weighed most) and its last lines.
  const subjectWords = wordsOf(m.subject.replace(/^(re|aw|wg|fwd?|antw):\s*/gi, ""));
  const words = [...new Set([...subjectWords, ...wordsOf(thread.map((x) => x.preview).join(" "))])].slice(0, 20);
  if (!words.length) return { thread, since: [] };
  const hits = (text: string) => words.filter((w) => text.toLowerCase().includes(w)).length;
  const later = getDb()
    .select()
    .from(emails)
    .where(and(gte(emails.receivedAt, m.receivedAt), sql`${emails.convId} <> ${m.convId}`))
    .orderBy(desc(emails.receivedAt))
    .limit(400)
    .all()
    .map((x) => ({ x, n: hits(`${x.subject} ${x.subject} ${x.preview}`) }))
    .filter((h) => h.n >= 2 || (h.n >= 1 && subjectWords.some((w) => h.x.subject.toLowerCase().includes(w))))
    .sort((a, b) => b.n - a.n)
    .slice(0, 4)
    .map(({ x }) => `[mail:${x.key}] ${x.receivedAt.slice(0, 10)} ${x.fromName ?? x.fromEmail ?? "?"} „${plain(x.subject, 80)}“: ${plain(x.preview, 160)}`);
  const todos = listTodos({ status: "all" })
    .filter((t) => (t.status === "open" || (t.doneAt ?? "") >= m.receivedAt) && t.createdAt >= m.receivedAt.slice(0, 10) && hits(t.text) >= 1 && subjectWords.some((w) => t.text.toLowerCase().includes(w)))
    .slice(0, 3)
    .map((t) => `[${t.id}] Todo${t.status === "done" ? " (erledigt)" : ""}: ${plain(t.text, 160)}`);
  return { thread, since: [...later, ...todos] };
}

/** An automatic answer (out of office, absent): no todo in it — the subject says so. */
const AUTO_REPLY = /^\s*(automatische antwort|automatic reply|auto[- ]?reply|abwesenheitsnotiz|abwesend|out of office|ooo)\b/i;

/**
 * A mail that isn't for the review at all: an automatic answer, or — with the GitLab plugin, whose
 * merge requests and comments the Ticket-Lage reads itself — a notification about a merge request or issue.
 */
export function notForReview(m: { fromEmail: string | null; subject: string; preview: string; folder: string }, gitlab: boolean): boolean {
  if (m.folder === "WhatsApp") return false;
  if (AUTO_REPLY.test(m.subject)) return true;
  // A merge request or issue (its link in the mail) — not GitLab's other mails (a token running out, a failed pipeline).
  return gitlab && /\/-\/(merge_requests|issues)\/\d+/.test(m.preview);
}

/** A training or course (in German or English). */
const TRAINING = /(pflicht|compliance|mandatory|required|obligatory|verpflichtend)[\s\S]{0,80}(schulung|training|kurs|course|e-?learning|modul|module)|(schulung|training|kurs|course|e-?learning)[\s\S]{0,80}(pflicht|mandatory|required|obligatory|verpflichtend)|course pending|kurs ausstehend|not yet completed the (mandatory )?(course|training)/i;
/** …asked of you: a reminder, a deadline, overdue, still to do. */
const DUE = /(reminder|erinnerung|frist|deadline|due|overdue|überfällig|fällig|pending|ausstehend|not yet completed|noch nicht (abgeschlossen|absolviert|erledigt)|please complete|bitte (absolvieren|abschließen))/i;
/** A document waiting for your signature. */
const SIGNATURE = /(warten auf (deine|ihre) (signatur|unterschrift)|waiting for (your )?signature|bitte (signiere|unterschreibe|unterzeichne)|please (sign|review and sign)|signatur(anfrage)? (angefordert|erforderlich)|signature (requested|required)|docusign|acrobat sign|adobe ?sign)/i;

/**
 * A mail you must act on — a mandatory training or course with a reminder or deadline, a document
 * waiting for your signature: never left without a todo (the AI is told so, and Zeff makes one when
 * it doesn't). Recognized by its words, not by the AI.
 */
export function mustDo(m: { fromName: string | null; fromEmail: string | null; subject: string; preview: string; folder: string }): boolean {
  if (m.folder === "WhatsApp") return false;
  const text = `${m.subject}\n${m.preview}`;
  if (TRAINING.test(text) && DUE.test(text)) return true;
  return SIGNATURE.test(`${m.fromName ?? ""} ${m.fromEmail ?? ""}\n${text}`) && /(sign|signatur|unterschr|unterzeichn)/i.test(text);
}

/** A mail as the review's prompt lists it — a must-do one marked. */
export function mailLine(m: { key: string; receivedAt: string; folder: string; fromName: string | null; fromEmail: string | null; subject: string; preview: string }): string {
  return `- ${mustDo(m) ? "⚠ PFLICHT " : ""}[mail:${m.key}] ${m.receivedAt.slice(0, 16).replace("T", " ")} (${m.folder}) ${m.fromName ?? m.fromEmail ?? "?"}: „${plain(m.subject, 200)}“ — ${plain(m.preview, 400)}`;
}

/**
 * The must-do mails the AI left without a todo (none of its todos or updates names them, no todo
 * cites them yet): a todo each from Zeff itself — the subject and the mail's first words, so two
 * courses with the same reminder subject stay two. A mail like one an open todo already has (the
 * same subject and opening — the next reminder) adds nothing.
 */
export function mustDoLeftOut<M extends { key: string; fromName: string | null; fromEmail: string | null; subject: string; preview: string; folder: string }>(
  batch: M[],
  answered: Set<string>,
  open: TodoView[],
  mailOf: (key: string) => M | undefined,
): { mails: M[]; text: string }[] {
  const sig = (m: { subject: string; preview: string }) => `${plain(m.subject, 200)}|${plain(m.preview, 160)}`.toLowerCase();
  const had = new Set(open.flatMap((t) => t.refs.filter((r) => r.startsWith("mail:")).map((r) => mailOf(r.slice(5)))).filter((m): m is M => !!m).map(sig));
  const groups = new Map<string, M[]>();
  for (const m of batch) {
    if (!mustDo(m) || answered.has(m.key) || had.has(sig(m))) continue;
    groups.set(sig(m), [...(groups.get(sig(m)) ?? []), m]);
  }
  return [...groups.values()].map((mails) => {
    const m = mails[mails.length - 1];
    const what = plain(m.preview, 140).replace(/^(external to the groupe[^.]*\.?|acme groupe)\s*/i, "");
    return { mails, text: `Pflicht aus Mail erledigen: „${plain(m.subject, 100)}“ — ${what}`.slice(0, 300) };
  });
}

/** A ticket key in a mail's subject or lines (one of the tickets the Lage reads — it has those mails). */
const namesTicket = (keys: string[], text: string) => keys.some((k) => new RegExp(`(^|[^A-Za-z0-9])${k}(?![0-9])`, "i").test(text));

/**
 * The review's own todos you judged: dropped by you, and done (the last 60 days, the newest first) —
 * each with the mail it came from (sender, subject), so the AI learns which kind you want.
 */
export function verdictLines(dropped: TodoView[]): { dropped: string[]; done: string[] } {
  const since = new Date(Date.now() - 60 * 864e5).toISOString();
  const mine = (t: TodoView) => t.source === "Mail-Durchsicht";
  const from = (t: TodoView) => {
    const key = t.refs.find((r) => r.startsWith("mail:"))?.slice(5);
    const m = key ? getDb().select().from(emails).where(sql`${emails.key} = ${key}`).get() : undefined;
    return m ? ` (aus: ${m.folder === "WhatsApp" ? "WhatsApp" : "Mail"} von ${m.fromName ?? m.fromEmail ?? "?"}, „${plain(m.subject, 80)}“)` : "";
  };
  const done = listTodos({ status: "done" }).filter((t) => mine(t) && (t.doneAt ?? "") >= since);
  const newest = (a: TodoView, b: TodoView) => (b.doneAt ?? "").localeCompare(a.doneAt ?? "");
  return {
    dropped: dropped.filter(mine).sort(newest).slice(0, 20).map((t) => `- ${plain(t.text, 140)}${from(t)}`),
    done: done.sort(newest).slice(0, 10).map((t) => `- ${plain(t.text, 140)}${from(t)}`),
  };
}

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
    // back (it may be weeks old: an old question never answered).
    const chatSince = new Date(Date.now() - Math.max(cp.numbers.days, cp.numbers.chatDays) * 864e5).toISOString();
    // Each conversation's last message, and whether you wrote in it (WhatsApp; mail now that your sent
    // mail is read): one you were part of whose last word isn't yours waits for you.
    const lastOf = new Map<string, typeof emails.$inferSelect>();
    const mineIn = new Set<string>();
    for (const m of getDb().select().from(emails).where(gte(emails.receivedAt, new Date(Date.now() - 60 * 864e5).toISOString())).orderBy(asc(emails.receivedAt)).all()) {
      lastOf.set(m.convId, m);
      if (m.fromName === "Ich") mineIn.add(m.convId);
    }
    const unanswered = (convId: string) => {
      const last = lastOf.get(convId);
      return !!last && last.fromName !== "Ich" && last.receivedAt >= chatSince && (last.folder === "WhatsApp" || mineIn.has(convId));
    };
    const rows = getDb()
      .select()
      .from(emails)
      .where(and(isNull(emails.reviewedAt), isNull(emails.resolvedAt), gte(emails.receivedAt, chatSince)))
      .orderBy(asc(emails.receivedAt))
      .all()
      .filter((m) => (m.folder === "WhatsApp" ? cp.sources.whatsapp : cp.sources.mail) && (m.receivedAt >= since || unanswered(m.convId)))
      // The chat list's unread badge, read as a message once ("5 ungelesene Nachrichten"): not one.
      .filter((m) => !(m.folder === "WhatsApp" && /^\d+ (ungelesene Nachricht|unread message)/i.test(m.preview)));
    const markReviewed = (keys: string[]) => {
      if (keys.length) getDb().update(emails).set({ reviewedAt: new Date().toISOString() }).where(inArray(emails.key, keys)).run();
    };
    const tickets = lastGoodRun()?.tickets.map((t) => t.key) ?? [];
    const cited = new Set(listTodos({ status: "all" }).flatMap((t) => t.refs.filter((r) => r.startsWith("mail:")).map((r) => r.slice(5))));
    // The Lage's (they name its tickets) and those a todo has already: gone through.
    const gitlab = isInstalled("gitlab");
    const theirs = rows.filter((m) => cited.has(m.key) || namesTicket(tickets, `${m.subject} ${m.preview}`) || notForReview(m, gitlab));
    markReviewed(theirs.map((m) => m.key));
    // A WhatsApp chat's messages together, in order (a conversation — your reply after a request
    // tells it's settled); the mails by time.
    const chatOf = (m: (typeof rows)[number]) => (m.folder === "WhatsApp" ? m.convId : "");
    const mails = rows.filter((m) => !theirs.includes(m)).sort((a, b) => chatOf(a).localeCompare(chatOf(b)) || a.receivedAt.localeCompare(b.receivedAt));
    // Conversations you were part of that have gone quiet (5–60 days) — each once per its last
    // message: is there news for the other side (from new messages, your todos), or do they still wait?
    const shownDormant = getPref<Record<string, string>>("mailtodos:dormant", {});
    const quietFrom = new Date(Date.now() - 60 * 864e5).toISOString();
    const quietTo = new Date(Date.now() - 5 * 864e5).toISOString();
    const dormant = [...lastOf.values()]
      .filter((m) => mineIn.has(m.convId) && m.receivedAt >= quietFrom && m.receivedAt <= quietTo && shownDormant[m.convId] !== m.key && (m.folder === "WhatsApp" ? cp.sources.whatsapp : cp.sources.mail))
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
      .slice(0, 40)
      // What happened on its topic since (other conversations, your todos) — found by its words.
      .map((m) => ({ m, ...sinceOnTopic(m) }))
      .slice(0, 15);
    // To compare against: every current conversation (last 30 days, its last message) — the AI
    // finds what belongs to a quiet one itself, under other words too.
    const recentFrom = new Date(Date.now() - 30 * 864e5).toISOString();
    const current = dormant.length
      ? [...lastOf.values()]
          .filter((x) => x.receivedAt >= recentFrom && !/no-?reply|newsletter|notification|mailer-daemon|news@|marketing/i.test(x.fromEmail ?? ""))
          .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
          .slice(0, 80)
      : [];
    if (!mails.length && !dormant.length) return { ok: true, reviewed: theirs.length, added: 0, batches: 0 };

    const ticketLines = tickets.map((k) => `- ${k}${getJiraTicket(k)?.summary ? ` — ${plain(getJiraTicket(k)!.summary, 120)}` : ""}`);
    const line = mailLine;
    const limit = aiChoice().provider === "copilot" ? BATCH_CHARS : 3 * BATCH_CHARS;
    const batches: (typeof mails)[] = mails.length ? [] : [[]];
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
      // What you dropped isn't proposed again (a new message in the same conversation isn't reason enough).
      const dropped = droppedByYou();
      const verdicts = verdictLines(dropped);
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
        ...(verdicts.dropped.length ? ["# Was ich verworfen habe (letzte 60 Tage)", ...verdicts.dropped, ""] : []),
        ...(verdicts.done.length ? ["# Was ich erledigt habe (letzte 60 Tage)", ...verdicts.done, ""] : []),
        "# Mails",
        ...(batch.length ? batch.map(line) : ["(keine neuen)"]),
        ...(batch === batches[0] && dormant.length
          ? [
              "",
              "# Ruhende Unterhaltungen (an denen ich beteiligt war, seit Tagen still)",
              ...dormant.flatMap(({ m, thread, since }) => [
                `- [mail:${m.key}] Unterhaltung „${plain(m.subject, 120)}“ (${m.folder}), still seit ${m.receivedAt.slice(0, 10)}:`,
                ...thread.map((x) => `    ${x.receivedAt.slice(0, 10)} ${x.fromName ?? x.fromEmail ?? "?"}: ${plain(x.preview, 600)}`),
                ...(since.length ? ["  Stichwort-Treffer seitdem (nur ein Hinweis):", ...since.map((s) => `    ${s}`)] : []),
              ]),
              "",
              "# Aktuelle Unterhaltungen (letzte 30 Tage, je die letzte Nachricht) — zum Abgleich mit den ruhenden",
              ...current.map((x) => `- [mail:${x.key}] ${x.receivedAt.slice(0, 10)} (${x.folder}) ${x.fromName ?? x.fromEmail ?? "?"} „${plain(x.subject, 80)}“: ${plain(x.preview, 140)}`),
            ]
          : []),
      ].join("\n");
      const answer = await runAi<Answer>(prompt, SCHEMA, { task: "mail-todos", timeoutMs: 10 * 60000, maxBudgetUsd: 1 }).catch((e) => {
        console.error("[mail-todos]", errorMessage(e));
        failed++;
        return null;
      });
      // A batch that fails: its mails are gone through next time.
      if (!answer) continue;
      const known = new Set([...batch, ...(batch === batches[0] ? dormant.map((d) => d.m) : [])].map((m) => `mail:${m.key}`));
      // The quiet conversations shown: not again until something new happens in them.
      if (batch === batches[0] && dormant.length) setPref("mailtodos:dormant", { ...shownDormant, ...Object.fromEntries(dormant.map((d) => [d.m.convId, d.m.key])) });
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
          if (duplicateTodo({ text, ops: [] }, open) || duplicateTodo({ text, ops: [] }, dropped)) continue;
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
      // A must-do mail (a mandatory training, a signature) is never held back by what you dropped.
      const must = new Set(batch.filter(mustDo).map((m) => `mail:${m.key}`));
      for (const td of answer.output?.todos ?? []) {
        const text = td.text?.trim();
        const refs = (td.refs ?? []).map((r) => String(r).trim().replace(/^\[|\]$/g, "")).map((r) => (r.startsWith("mail:") ? r : `mail:${r}`)).filter((r) => known.has(r));
        if (!text || !refs.length) continue;
        const ticket = td.ticket?.trim().toUpperCase() ?? "";
        if (duplicateTodo({ text, ops: [] }, open) || (!refs.some((r) => must.has(r)) && duplicateTodo({ text, ops: [] }, dropped))) continue;
        const t = attributed(runId ? `lage:${runId}` : "mail", () =>
          addMailTodo({ ticket: tickets.includes(ticket) ? ticket : "", text, kind: isTodoKind(td.kind) ? td.kind : "other", owner: td.owner === "other" ? "other" : "me", refs, runId, due: td.due ?? null }),
        );
        open.push(t);
        added++;
      }
      // The must-do mails the AI left without a todo: one from Zeff itself — none is missed.
      const answered = new Set(
        [...(answer.output?.todos ?? []), ...(answer.output?.updates ?? [])].flatMap((x) => (x.refs ?? []).map((r) => String(r).trim().replace(/^\[|\]$/g, "").replace(/^mail:/, ""))),
      );
      const mailOf = (key: string) => batch.find((m) => m.key === key) ?? getDb().select().from(emails).where(sql`${emails.key} = ${key}`).get();
      for (const left of mustDoLeftOut(batch, answered, open, mailOf)) {
        const t = attributed(runId ? `lage:${runId}` : "mail", () => addMailTodo({ ticket: "", text: left.text, kind: "other", owner: "me", refs: left.mails.map((m) => `mail:${m.key}`), runId }));
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
