/**
 * Who asked for it, and telling them it's there: a todo made from someone's message (a Teams chat, a mail, a WhatsApp or
 * Signal chat) hands its work on — a worker's follow-up, the push, the merge request — and the message is far back on the
 * chain. Delivered (a branch pushed, a merge request opened or merged), the one who asked gets a reply todo in that chat,
 * its draft saying so with the link — in a Teams chat of the two of you a button sends it (your click). Server only.
 */
import { getSqlite } from "@/db";
import type { TodoView } from "./shared";

export type Requester = { ref: string; who: string; channel: "teams" | "mail" | "whatsapp" | "signal"; oneOnOne: boolean };

const ASK_REF = /^(teams|mail):/;
/** How far up the chain a todo's asker is looked for (message → todo → worker follow-up → push → MR → merge). */
const DEPTH = 8;

/** The message a todo (or the todo it came from, and so on up) was made from, and who wrote it — not you. */
export async function requesterOf(todo: Pick<TodoView, "id" | "refs" | "parentId">): Promise<Requester | null> {
  const { getTodo } = await import("./store");
  const seen = new Set<number>();
  let t: Pick<TodoView, "id" | "refs" | "parentId"> | undefined = todo;
  for (let i = 0; t && i < DEPTH && !seen.has(t.id); i++) {
    seen.add(t.id);
    for (const ref of [...t.refs].reverse()) {
      if (!ASK_REF.test(ref)) continue;
      const r = whoWrote(ref);
      if (r) return r;
    }
    t = t.parentId ? getTodo(t.parentId) : undefined;
  }
  return null;
}

/** Who wrote the message a ref names (not you), and in what chat — null for one of yours or one Zeff doesn't keep. */
export function whoWrote(ref: string): Requester | null {
  const key = ref.slice(ref.indexOf(":") + 1);
  try {
    if (ref.startsWith("teams:")) {
      const m = getSqlite().prepare("select kind, sender_name, conversation_id from teams_messages where key = ?").get(key) as { kind: string; sender_name: string | null; conversation_id: string } | undefined;
      // Theirs: a message to you (a pm or a mention) — a chat line of yours names no asker.
      if (!m?.sender_name || (m.kind !== "pm" && m.kind !== "mention")) return null;
      return { ref, who: m.sender_name, channel: "teams", oneOnOne: /@unq\.gbl\.spaces$/.test(m.conversation_id) };
    }
    const m = getSqlite().prepare("select from_name, from_email, conv_id, is_group from emails where key = ?").get(key) as { from_name: string | null; from_email: string | null; conv_id: string; is_group: number | null } | undefined;
    if (!m || m.from_name === "Ich") return null;
    const channel = m.conv_id.startsWith("wa:") ? "whatsapp" : m.conv_id.startsWith("sg:") ? "signal" : "mail";
    return { ref, who: m.from_name || m.from_email || "", channel, oneOnOne: channel !== "mail" && !m.is_group };
  } catch {
    return null;
  }
}

/** What was delivered, as an op's result says it: the merge request's link, else none. */
export function mrLink(what: string): string | null {
  return /https?:\/\/\S+\/merge_requests\/\d+/.exec(what)?.[0] ?? null;
}

/**
 * Delivered: a reply todo to the one who asked — on the todo that delivered, in their chat, its draft with the link. Not
 * when nobody asked (a ticket of your own), nor twice for the same chain and chat while one is open. The todo made, or null.
 */
export async function tellRequester(todo: TodoView, delivered: { what: string; link: string | null }): Promise<TodoView | null> {
  const asker = await requesterOf(todo);
  if (!asker?.who) return null;
  const store = await import("./store");
  // One open "tell them" per chat and ticket is enough (push, then MR, then merge: the newest link goes into it).
  const open = store.listTodos({ status: "open" }).find((t) => t.kind === "reply" && t.source?.startsWith("Delivered:") && t.refs.includes(asker.ref) && t.ticket === todo.ticket);
  const first = asker.who.split(/\s+/)[0];
  const what = delivered.link ? `${todo.ticket ? `${todo.ticket} ` : ""}ist bereit zum Review: ${delivered.link}` : `${todo.ticket ? `${todo.ticket}: ` : ""}${delivered.what}`;
  const draft = `Hi ${first}, ${what}`;
  const ops = asker.channel === "teams" && asker.oneOnOne ? [{ type: "teams-message" as const, to: asker.who, body: draft }] : [];
  if (open) {
    // The newest delivery's words (the MR after the push): the draft and its button.
    store.setTodoDraft(open.id, { draft });
    if (ops.length) store.setTodoOps(open.id, ops as TodoView["ops"]);
    return store.getTodo(open.id) ?? open;
  }
  const g = store.addFollowUp({
    ticket: todo.ticket,
    text: `Tell ${asker.who} it's delivered${delivered.link ? ` (${delivered.link.replace(/^https?:\/\/[^/]+\//, "")})` : ""}`,
    kind: "reply",
    draft,
    channel: asker.channel === "teams" ? "teams" : null,
    target: asker.ref,
    parentId: todo.id,
    workRunId: null,
    source: `Delivered: ${todo.ref} → ${asker.who}`,
    ops,
  });
  return g;
}
