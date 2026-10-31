/**
 * Todos closed by what happened, right after the sync that brought it (no AI): a reply todo whose
 * message you have answered since — in the same chat, mail thread or Jira ticket — is done, its note
 * saying when and with what words. A reply that only puts it off ("schau ich mir an", "melde mich") and
 * a "clarify" todo are only proposed (the grey tick). Opened again by you: that answer never closes it
 * again (the next one may). Server only.
 */
import { getPref, setPref } from "@/lib/prefs";
import { attributed } from "./activity";
import { listTodos, setTodoStatus, suggestDone } from "./store";
import { flatTruncate } from "@/lib/text";

/** The kinds a message of yours in their thread settles: answering is the todo. */
const CLOSE_KINDS = new Set(["reply", "comment"]);
/** Answered there is likely, not surely, the todo ("clarify with X" may need more than one message): proposed. */
const PROPOSE_KINDS = new Set(["clarify"]);
/** The refs whose thread can be followed (loops/source.ts). */
const THREAD_REF = /^(teams|mail|jira-comment):/;

type Ledger = {
  /** Closed by this rule: the todo and the answer that closed it — to notice it was opened again. */
  closed: Record<string, { ref: string; at: string }>;
  /** Proposed by this rule (the grey tick): the answer — a proposal gone while the todo is still open was turned down. */
  proposed: Record<string, string>;
  /** Opened again after it closed them, or the proposal turned down: the answers that may not close the todo again. */
  rejected: Record<string, string[]>;
};
const KEY = "todo-evidence";
const read = (): Ledger => {
  const l = getPref<Partial<Ledger>>(KEY, {});
  return { closed: l.closed ?? {}, proposed: l.proposed ?? {}, rejected: l.rejected ?? {} };
};

export type EvidenceVerdict = { todoId: number; action: "close" | "propose"; ref: string; at: string; quote: string; source: string };

/** A stored time ("2026-10-26 08:17:54" from SQLite, or ISO) as ISO — to compare with the messages' times. */
const isoOf = (v: string) => (/^\d{4}-\d{2}-\d{2} \d/.test(v) ? `${v.replace(" ", "T")}Z` : v);
const SOURCE_NAME: Record<string, string> = { teams: "Teams", mail: "the mail thread", jira: "Jira" };
const hhmm = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

/**
 * What the open reply todos' threads say now: each todo answered in every thread it names (after its newest message
 * there) — the answer that did it. Read only; `closeTodosByEvidence` acts on it.
 */
export async function evidenceVerdicts(): Promise<EvidenceVerdict[]> {
  const { sourceMessage, laterMessages } = await import("@/plugins/loops/source");
  const { isDeferral, sharesTopic } = await import("@/plugins/loops/shared");
  const me = await myIdentity();
  // Names say nothing about what a todo is about ("Wolfgang" in the todo and in an unrelated answer): left out of the topic words.
  const names = [...me, ...(await peopleNames())];
  const ledger = read();
  const out: EvidenceVerdict[] = [];
  for (const t of listTodos({ status: "open" })) {
    // Already proposed done (by this rule or another): that waits for you.
    if (t.workerDone) continue;
    if (t.owner !== "me" || !(CLOSE_KINDS.has(t.kind) || PROPOSE_KINDS.has(t.kind))) continue;
    const refs = t.refs.filter((r) => THREAD_REF.test(r));
    if (!refs.length) continue;
    // Only an answer after the todo was made answers it: one before was what the todo was made from (or knew already).
    const since = isoOf(t.createdAt);
    const rejected = new Set(ledger.rejected[t.id] ?? []);
    // Per thread: its newest message the todo names — the answer has to come after it.
    const threads = new Map<string, { src: ReturnType<typeof sourceMessage>; at: string }>();
    for (const r of refs) {
      const src = sourceMessage(r);
      if (src.kind === "other" || !src.thread || !src.at) continue;
      const k = `${src.kind}|${src.thread}`;
      const was = threads.get(k);
      if (!was || src.at > was.at) threads.set(k, { src, at: src.at });
    }
    if (!threads.size) continue;
    let answer: { ref: string; at: string; text: string; kind: string; prompt: boolean; chat: boolean } | null = null;
    let all = true;
    for (const { src, at } of threads.values()) {
      const mine = laterMessages(src, at, me).find((m) => m.mine && m.at >= since && !rejected.has(m.ref) && m.text.trim());
      if (!mine) {
        all = false;
        break;
      }
      // A chat of the two of you (Teams 1:1, a WhatsApp or Signal chat that isn't a group): what you write there is the answer.
      // …written within a day of theirs: days later it may be about anything ("Hey, bist du zuhause?").
      const oneOnOne = !src.group && ((src.kind === "teams" && /@unq\.gbl\.spaces$/.test(src.thread)) || /^(wa|sg):/.test(src.thread));
      const prompt = oneOnOne && Date.parse(mine.at) - Date.parse(at) <= DAY;
      const chat = src.kind === "teams" || /^(wa|sg):/.test(src.thread);
      if (!answer || mine.at > answer.at) answer = { ref: mine.ref, at: mine.at, text: mine.text, kind: src.kind, prompt, chat };
    }
    if (!all || !answer) continue;
    // Sure: a prompt answer to them in a chat of the two of you, or one about what the todo says; else (a mail thread, a group,
    // days later, other words) only proposed — it may be about something else.
    const topic = sharesTopic(t.text, answer.text, names);
    const sure = CLOSE_KINDS.has(t.kind) && !isDeferral(answer.text) && (answer.prompt || topic);
    // A chat goes on about anything: there only a prompt answer or one on the topic counts at all (a mail thread is about its subject).
    if (!sure && answer.chat && !answer.prompt && !topic) continue;
    out.push({ todoId: t.id, action: sure ? "close" : "propose", ref: answer.ref, at: answer.at, quote: flatTruncate(answer.text, 140), source: SOURCE_NAME[answer.kind] ?? answer.kind });
  }
  return out;
}

const DAY = 864e5;

/** Everyone's names Zeff knows (lower case; none without the People plugin). */
async function peopleNames(): Promise<string[]> {
  try {
    const { listPeople } = await import("@/plugins/people/store");
    return listPeople().flatMap((p) => [p.name, ...(p.aliases ?? [])]).map((n) => String(n).toLowerCase());
  } catch {
    return [];
  }
}

/** You, as the sources name you (lower case): your names, and the handles of the person that is you. */
async function myIdentity(): Promise<Set<string>> {
  try {
    const { whoAmI } = await import("@/plugins/loops/detect");
    const me = whoAmI();
    return new Set([...me.names, ...me.handles].map((s) => s.toLowerCase()));
  } catch {
    return new Set();
  }
}

/**
 * The open reply todos you have answered since: closed (or proposed) with the answer as their note. A todo this closed
 * that is open again was opened by you: its answer is kept as "not this one". How many of each.
 */
export async function closeTodosByEvidence(): Promise<{ closed: number; proposed: number }> {
  const ledger = read();
  let changed = false;
  // Opened again by you since this closed it, or its proposal turned down (the todo open, the grey tick gone): that
  // answer doesn't count for it any more. A proposal you took (the todo done) is just forgotten.
  const openTodos = new Map(listTodos({ status: "open" }).map((t) => [String(t.id), t]));
  const reject = (id: string, ref: string) => void (ledger.rejected[id] = [...new Set([...(ledger.rejected[id] ?? []), ref])]);
  for (const [id, c] of Object.entries(ledger.closed)) {
    if (!openTodos.has(id)) continue;
    reject(id, c.ref);
    delete ledger.closed[id];
    changed = true;
  }
  for (const [id, ref] of Object.entries(ledger.proposed)) {
    const t = openTodos.get(id);
    if (t?.workerDone) continue;
    if (t) reject(id, ref);
    delete ledger.proposed[id];
    changed = true;
  }
  if (changed) setPref(KEY, ledger);
  let closed = 0;
  let proposed = 0;
  for (const v of await evidenceVerdicts()) {
    const note = `You replied in ${v.source}${hhmm(v.at) ? ` at ${hhmm(v.at)}` : ""}: “${v.quote}”`;
    try {
      if (v.action === "close") {
        attributed("rule:replied", () => setTodoStatus(v.todoId, "done", `Done — ${note}`));
        ledger.closed[v.todoId] = { ref: v.ref, at: new Date().toISOString() };
        closed++;
      } else {
        suggestDone(v.todoId, "Your reply", `Answered? ${note}`);
        ledger.proposed[v.todoId] = v.ref;
        proposed++;
      }
    } catch (e) {
      console.error(`[evidence] T-${v.todoId}:`, e);
    }
  }
  if (closed || proposed) setPref(KEY, ledger);
  return { closed, proposed };
}
