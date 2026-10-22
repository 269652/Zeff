/**
 * Where a loop was said, as the sources keep it (the loops plugin): a claim's source ref ("mail:<key>", "teams:<key>",
 * "jira-comment:<id>" …) read back to its message — when, in which thread or chat, the link — and the messages after it in that
 * thread, for the closing by rule. Server only.
 */
import { getSqlite } from "@/db";
import { refSourceKey } from "@/lib/boundaries/shared";
import { toIso } from "@/plugins/timeline/indexer";

export type SourceMessage = {
  /** mail (mail, Gmail, WhatsApp, Signal), teams, jira; other: a ref the rules can't follow (a document, a fact). */
  kind: "mail" | "teams" | "jira" | "other";
  at: string | null;
  href: string;
  /** The chat or thread: an emails conv_id, a Teams conversation, a Jira ticket key. */
  thread: string;
  group: boolean;
};

/** A later message of a thread: who wrote it, is it yours, its words, an attachment on it. */
export type LaterMessage = { ref: string; at: string; from: string; mine: boolean; text: string; attachment: boolean; pm?: boolean };

const one = <T>(sql: string, ...args: unknown[]): T | undefined => {
  try {
    return getSqlite().prepare(sql).get(...args) as T | undefined;
  } catch {
    return undefined;
  }
};
const all = <T>(sql: string, ...args: unknown[]): T[] => {
  try {
    return getSqlite().prepare(sql).all(...args) as T[];
  } catch {
    return [];
  }
};

/** A chat's or mail's link in Zeff (as the timeline makes them). */
export function mailHref(conv: string, subject: string): string {
  if (conv.startsWith("wa:")) return `/apps/whatsapp?chat=${encodeURIComponent(conv.slice(3))}`;
  if (conv.startsWith("sg:")) return `/apps/signal?chat=${encodeURIComponent(conv.slice(3))}`;
  return `/mail?q=${encodeURIComponent(subject)}`;
}

/** The boundary source of a source ref (lib/boundaries); "people" when none is known. */
export const sourceOf = (sourceRef: string): string => refSourceKey(sourceRef) ?? (sourceRef.startsWith("msg:") ? sourceRef.split(":")[1] : "people");

export function sourceMessage(sourceRef: string): SourceMessage {
  const i = sourceRef.indexOf(":");
  const head = i > 0 ? sourceRef.slice(0, i) : "";
  const rest = i > 0 ? sourceRef.slice(i + 1) : "";
  if (head === "mail") {
    const m = one<{ conv_id: string; received_at: string; subject: string; is_group: number | null }>("select conv_id, received_at, subject, is_group from emails where key = ?", rest);
    const conv = m?.conv_id ?? rest.split("|")[0];
    return { kind: "mail", at: m?.received_at ?? null, href: mailHref(conv, m?.subject ?? ""), thread: conv, group: !!m?.is_group };
  }
  if (head === "teams") {
    const m = one<{ conversation_id: string; sent_at: string; link: string }>("select conversation_id, sent_at, link from teams_messages where key = ?", rest);
    return { kind: "teams", at: m?.sent_at ?? null, href: m?.link ?? "", thread: m?.conversation_id ?? rest.split("|")[0], group: false };
  }
  if (head === "jira-comment") {
    const c = one<{ ticket: string; at: string; url: string | null }>("select c.ticket, c.at, t.url from jira_comments c left join jira_tickets t on t.key = c.ticket where c.id = ?", rest);
    return { kind: "jira", at: c?.at ?? null, href: c?.url ?? "", thread: c?.ticket ?? "", group: false };
  }
  if (head === "doc") return { kind: "other", at: null, href: `/documents?doc=${encodeURIComponent(rest)}`, thread: "", group: false };
  return { kind: "other", at: null, href: "", thread: "", group: false };
}

/** The messages after `at` in a thread, in time order. `me`: your names (lower case) — Teams and Jira say who you are by name. */
export function laterMessages(src: SourceMessage, at: string, me: Set<string>): LaterMessage[] {
  if (!src.thread || !at) return [];
  if (src.kind === "mail") {
    return all<{ key: string; received_at: string; from_name: string | null; from_email: string | null; preview: string; has_attachments: number | null }>("select key, received_at, from_name, from_email, preview, has_attachments from emails where conv_id = ? and received_at > ? order by received_at, key", src.thread, at).map((m) => ({
      ref: `mail:${m.key}`,
      at: m.received_at,
      from: m.from_name ?? m.from_email ?? "",
      mine: m.from_name === "Ich",
      text: m.preview,
      attachment: !!m.has_attachments,
    }));
  }
  if (src.kind === "teams") {
    const rows = all<{ key: string; sent_at: string; kind: string; sender_name: string | null; sender_id: string | null; text: string }>("select key, sent_at, kind, sender_name, sender_id, text from teams_messages where conversation_id = ? order by sent_at, key", src.thread);
    const theirs = new Set(rows.filter((m) => m.kind === "pm" && m.sender_id).map((m) => m.sender_id!));
    return rows
      .filter((m) => m.sent_at > at)
      .map((m) => ({
        ref: `teams:${m.key}`,
        at: m.sent_at,
        from: m.sender_name ?? "",
        // You by your name; without one known, Teams's own hint: a chat line not from the other side of a 1:1 chat.
        mine: me.size ? me.has((m.sender_name ?? "").trim().toLowerCase()) : m.kind !== "pm" && m.kind !== "mention" && !!m.sender_id && !theirs.has(m.sender_id),
        text: m.text,
        attachment: false,
        pm: m.kind === "pm",
      }));
  }
  if (src.kind === "jira") {
    return all<{ id: string; at: string; author: string; body: string }>("select id, at, author, body from jira_comments where ticket = ? and at > ? order by at, id", src.thread, at).map((c) => ({
      ref: `jira-comment:${c.id}`,
      at: c.at,
      from: c.author,
      mine: me.has(c.author.trim().toLowerCase()),
      text: c.body,
      attachment: false,
    }));
  }
  return [];
}

/** A Jira ticket done after `at`: its status (null: not done, or not since then). */
export function ticketDoneSince(key: string, at: string): string | null {
  const t = one<{ status: string; status_category: string; updated_at: string | null }>("select status, status_category, updated_at from jira_tickets where key = ?", key);
  // Jira's times are local ("… 16:27:04 Mitteleuropäische Sommerzeit"): compared as ISO.
  return t && t.status_category === "done" && (toIso(t.updated_at) ?? "") > (toIso(at) ?? at) ? t.status : null;
}

/** Who besides you wrote in a thread (their names, lower case) — more than one: many people talk there. */
export function threadSenders(src: SourceMessage, me: Set<string>): Set<string> {
  const names = (rows: { n: string | null }[]) => new Set(rows.map((r) => (r.n ?? "").trim().toLowerCase()).filter((n) => n && !me.has(n)));
  if (!src.thread) return new Set();
  if (src.kind === "mail") return names(all<{ n: string | null }>("select distinct coalesce(from_email, from_name) n from emails where conv_id = ? and coalesce(from_name, '') != 'Ich'", src.thread));
  if (src.kind === "teams") return names(all<{ n: string | null }>("select distinct sender_name n from teams_messages where conversation_id = ?", src.thread));
  if (src.kind === "jira") return names(all<{ n: string | null }>("select distinct author n from jira_comments where ticket = ?", src.thread));
  return new Set();
}
