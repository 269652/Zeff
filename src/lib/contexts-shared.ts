/**
 * Context items (a colleague's message, a Teams message, a Jira comment) — the parts the
 * forms and cards share with the server. No DB access here (client-safe).
 */
import { isoDay } from "@/lib/text";
import { translator, type T } from "@/lib/i18n/shared";
import { imageTargets, mapImageTargets, markdownToPlain, normalizeListIndent } from "./markdown";

/** English (the default for the label helpers below; client components pass their useT() t). */
const en = translator("en");

export const CONTEXT_KINDS = ["teams", "jira", "gitlab", "email", "note"] as const;
export type ContextKind = (typeof CONTEXT_KINDS)[number];

/** The kinds' names in a language (client: `contextKindLabels(useT())`). */
export const contextKindLabels = (t: T): Record<ContextKind, string> => ({
  teams: "Teams",
  jira: "Jira",
  gitlab: "GitLab",
  email: t("Email"),
  note: t("Note"),
});
/** In English (shown through t() — or use contextKindLabels(t)). */
export const CONTEXT_KIND_LABELS: Record<ContextKind, string> = contextKindLabels(en);

export const isContextKind = (v: unknown): v is ContextKind => (CONTEXT_KINDS as readonly unknown[]).includes(v);

/** In front of the names of the entry form's "Add context" fields — date and ticket there are the entry's own. */
export const ENTRY_CONTEXT_PREFIX = "ctx-";

/** A picture downloaded for a message (pasted as a link, e.g. from GitLab): its data in base64, or why not. */
export type FetchedImage =
  | { url: string; ok: true; name: string; mime: string; size: number; data: string }
  | { url: string; ok: false; error: string };

/** A picture target on the web (not yet the item's own file). */
export const isRemoteImage = (target: string) => /^https?:\/\//i.test(target);

/** One link of a context item; `label` is optional (see linkLabel). */
export type ContextLink = { url: string; label: string | null };

/** GitLab's own pages: on a gitlab host, a "git." host, or behind GitLab's "/-/" path separator. */
const GITLAB_URL = /^https?:\/\/(?:[^/]*gitlab\.|git\.)[^/]+\/|\/-\/(?:merge_requests|issues|work_items|commits?|blob|tree|pipelines|jobs|compare|wikis|snippets|epics|milestones|releases|tags)\b/;

/** What a link points at: a Teams message, a Jira issue or comment, a GitLab page, a mail — null for any other page. */
export function kindOfUrl(url: string): Exclude<ContextKind, "note"> | null {
  const u = url.trim().toLowerCase();
  if (!u) return null;
  if (/^zeff:mail:/.test(u)) return "email";
  if (/^msteams:|teams\.microsoft\.com|teams\.live\.com|teams\.cloud\.microsoft/.test(u)) return "teams";
  if (/\/browse\/[a-z][a-z0-9]+-\d+|atlassian\.net|jira\./.test(u)) return "jira";
  if (GITLAB_URL.test(u)) return "gitlab";
  if (/^mailto:|outlook\.(office|office365|live)\.com|outlook\.cloud\.microsoft/.test(u)) return "email";
  return null;
}

/**
 * What a GitLab link points at, as GitLab writes it: "proj-bund !167" (a merge request),
 * "proj-bund #12" (an issue), "proj-bund @1a2b3c4" (a commit) — "comment" added for a link to
 * one of their comments (#note_…). Null when the address doesn't say.
 */
export function describeGitlabLink(url: string | null | undefined, t: T = en): string | null {
  try {
    const u = new URL(url ?? "");
    const m = /^\/(.+?)\/-\/(merge_requests|issues|work_items|commit|commits)\/([^/?#]+)/.exec(u.pathname);
    const project = (m?.[1] ?? u.pathname.split("/-/")[0]).split("/").filter(Boolean).pop();
    if (!m) return project ? `GitLab · ${decodeURIComponent(project)}` : null;
    const ref = m[2] === "merge_requests" ? `!${m[3]}` : m[2].startsWith("commit") ? `@${m[3].slice(0, 8)}` : `#${m[3]}`;
    const what = `${project ? `${decodeURIComponent(project)} ` : ""}${ref}`;
    return /^#note_/.test(u.hash) ? t("{what} comment", { what }) : what;
  } catch {
    return null;
  }
}

/** The Jira issue a link is about ("…/browse/PROJ-337?focusedCommentId=…" → "PROJ-337"). */
export function ticketOfUrl(url: string | null | undefined): string | null {
  const m = /\/browse\/([A-Za-z][A-Za-z0-9]+-\d+)/.exec(url ?? "");
  return m ? m[1].toUpperCase() : null;
}

/**
 * Where a Teams message link points — its team and channel, and when it was written, as far
 * as the link says (Teams puts teamName, channelName and createdTime in the query).
 */
export function describeTeamsLink(url: string | null | undefined): { place: string | null; date: string | null } {
  try {
    const u = new URL(url ?? "");
    const team = u.searchParams.get("teamName");
    const channel = u.searchParams.get("channelName");
    const created = Number(u.searchParams.get("createdTime"));
    const place = [team, channel].filter(Boolean).join(" › ") || null;
    let date: string | null = null;
    if (Number.isFinite(created) && created > 1e12) {
      const d = new Date(created);
      date = isoDay(d);
    }
    return { place, date };
  } catch {
    return { place: null, date: null };
  }
}

/**
 * A link's label: its own, else what it points at ("PROJ-337 comment", "Teams · PROJ › General", "proj-bund !167", the host).
 * In English by default — as posted to Jira (jiraCommentMarkdown, its sync hash); the UI passes its t.
 */
export function linkLabel(link: ContextLink, t: T = en): string {
  if (link.label?.trim()) return link.label.trim();
  const todo = /^zeff:todo:(\d+)$/.exec(link.url.trim());
  if (todo) return t("Todo {ref}", { ref: `T-${todo[1]}` });
  const ticket = ticketOfUrl(link.url);
  if (ticket) return /focusedCommentId|#comment-/i.test(link.url) ? t("{what} comment", { what: ticket }) : ticket;
  const kind = kindOfUrl(link.url);
  if (kind === "teams") {
    const { place } = describeTeamsLink(link.url);
    return place ? `Teams · ${place}` : t("Teams message");
  }
  if (kind === "gitlab") {
    const what = describeGitlabLink(link.url, t);
    if (what) return what;
  }
  if (/^mailto:/i.test(link.url)) return link.url.slice(7);
  try {
    return new URL(link.url).hostname.replace(/^www\./, "");
  } catch {
    return link.url;
  }
}

/** Links as stored (JSON), dropping anything malformed. */
export function parseLinks(json: string | null | undefined): ContextLink[] {
  try {
    const raw = JSON.parse(json || "[]");
    return Array.isArray(raw) ? cleanLinks(raw) : [];
  } catch {
    return [];
  }
}

/** Trimmed links with a URL, without duplicates; a blank label is null. */
export function cleanLinks(raw: unknown[]): ContextLink[] {
  const seen = new Set<string>();
  const out: ContextLink[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const url = typeof o.url === "string" ? o.url.trim() : "";
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const label = typeof o.label === "string" && o.label.trim() ? o.label.trim() : null;
    out.push({ url, label });
  }
  return out;
}

/** A context item's headline: its title, else the message's first line (clipped), else its first link. */
export function contextHeadline(c: { title: string | null; body: string; links: ContextLink[] }, t: T = en): string {
  const title = c.title?.trim();
  if (title) return title;
  const line = markdownToPlain(c.body).split("\n").find(Boolean);
  if (line) return line.length > 90 ? `${line.slice(0, 88)}…` : line;
  return c.links[0] ? linkLabel(c.links[0], t) : t("(empty)");
}

/** What the forms post. */
export type ContextInput = {
  kind: ContextKind;
  title: string | null;
  author: string | null;
  body: string;
  links: ContextLink[];
  date: string | null;
  /** The Jira ticket it belongs to, e.g. "PROJ-337". */
  ticket: string | null;
};

/** An entry a context item backs (for "also on …" and the Context tab). */
export type ContextUse = { id: number; date: string; hours: number; description: string; jobNumber: string; ticket: string | null };

/** A file attached to a context item; `storedName` is its file name on disk — and as a Jira attachment. */
export type ContextFileInfo = { id: number; name: string; mime: string; size: number; jiraSyncedAt: string | null; storedName: string };

/** The files a message shows inline (its ![…](attachment:id) images). */
export function inlineFileIds(body: string): Set<number> {
  return new Set(imageTargets(body).flatMap((t) => (/^attachment:\d+$/.test(t) ? [Number(t.slice(11))] : [])));
}

export type ContextItem = {
  id: number;
  kind: ContextKind;
  title: string | null;
  author: string | null;
  body: string;
  links: ContextLink[];
  date: string | null;
  ticket: string | null;
  files: ContextFileInfo[];
  jiraCommentId: string | null;
  jiraSyncedAt: string | null;
  jiraSyncedHash: string | null;
  createdAt: string;
  updatedAt: string;
  /** The entries it backs, newest first. */
  entries: ContextUse[];
};

/**
 * The source an item is — its link to a synced Teams message or GitLab item (`linked`: those
 * links) — when it has nothing of its own: no headline, no message, no files. Null for a note,
 * which may link sources too, its own words first.
 */
export function itemSource(c: Pick<ContextItem, "title" | "body" | "files" | "links">, linked: Record<string, unknown>): ContextLink | null {
  if (c.title?.trim() || c.body.trim() || c.files.length) return null;
  return c.links.find((l) => linked[l.url]) ?? null;
}

/** One context item at a glance (the entries table's hover card). */
export type ContextBriefItem = {
  id: number;
  kind: ContextKind;
  author: string | null;
  date: string | null;
  headline: string;
  /** The message as plain text after the headline, clipped. */
  excerpt: string;
  ticket: string | null;
  links: { url: string; label: string; kind: ContextKind | null }[];
  /** Its files, pictures in the message included. */
  files: number;
  sync: JiraSyncState;
};

/** An entry's context at a glance: how many items, the first one's headline, and each item. */
export type ContextBrief = { count: number; headline: string; items: ContextBriefItem[] };

/** A context item as the hover card shows it. */
export function contextBriefItem(c: ContextItem, t: T = en): ContextBriefItem {
  const headline = contextHeadline(c, t);
  const lines = markdownToPlain(c.body).split("\n").map((l) => l.trim());
  // Without a title the headline is the message's first line — the excerpt carries on after it.
  if (!c.title?.trim()) lines.splice(0, lines.findIndex(Boolean) + 1);
  const excerpt = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return {
    id: c.id,
    kind: c.kind,
    author: c.author,
    date: c.date,
    headline,
    excerpt: excerpt.length > 600 ? `${excerpt.slice(0, 598)}…` : excerpt,
    ticket: c.ticket,
    links: c.links.slice(0, 4).map((l) => ({ url: l.url, label: linkLabel(l, t), kind: kindOfUrl(l.url) })),
    files: c.files.length,
    sync: jiraSyncState(c),
  };
}

/** A Jira ticket key as typed ("proj-337 " → "PROJ-337"), or null when it isn't one. */
export function normalizeTicket(raw: string | null | undefined): string | null {
  const t = (raw ?? "").trim().toUpperCase();
  return /^[A-Z][A-Z0-9]+-\d+$/.test(t) ? t : null;
}

const fmtDate = (iso: string | null) => (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${Number(iso.slice(8))}.${Number(iso.slice(5, 7))}.${iso.slice(0, 4)}` : null);

/** A comment's bold header when the item has no headline of its own. */
const COMMENT_HEAD: Record<ContextKind, string> = { teams: "Teams message", jira: "Jira comment", gitlab: "GitLab comment", email: "Mail", note: "Note" };

/**
 * The Jira comment a context item is posted as (Markdown — the Jira server converts it to
 * wiki markup): its headline (or what it is) in bold with who and when, the message in a
 * {quote} — lists re-indented for Jira, pasted images shown inline by their attachment name
 * (the sync attaches them first) — then its links and the files not shown inline. `linked`:
 * links to synced Teams messages / GitLab items, with a heading and their words, quoted.
 */
export function jiraCommentMarkdown(
  c: Pick<ContextItem, "kind" | "title" | "author" | "body" | "links" | "date" | "files">,
  linked: Record<string, { heading: string; text: string }> = {},
): string {
  const who = [c.author, fmtDate(c.date)].filter(Boolean).join(", ");
  // A source of its own: its heading says who and what — no heading of the item's.
  const sourceOnly = itemSource(c, linked) !== null;
  const lines = sourceOnly ? [] : [`**${c.title?.trim() || COMMENT_HEAD[c.kind]}**${who ? ` — ${who}` : ""}`];
  const files = new Map(c.files.map((f) => [f.id, f]));
  const inline = inlineFileIds(c.body);
  const attachments = new Set<string>();
  const mapped = mapImageTargets(c.body.trim(), (target) => {
    const f = /^attachment:\d+$/.test(target) ? files.get(Number(target.slice(11))) : undefined;
    if (f) attachments.add(f.storedName);
    return f ? f.storedName : target;
  });
  // Attached pictures as a plain "!name!" in Jira: an alt text (GitLab's is the file name, spaces and all) only gets in the way.
  const body = normalizeListIndent(mapped).replace(/!\[[^\]\n]*\]\(([^)\s]+)\)/g, (m, t: string) => (attachments.has(t) ? `![](${t})` : m));
  if (body && body !== c.title?.trim()) lines.push("", "{quote}", body, "{quote}");
  // Linked sources (synced Teams messages, GitLab items) bring their own words; other links are listed.
  for (const l of c.links) {
    const s = linked[l.url];
    if (s) lines.push("", s.heading, "{quote}", normalizeListIndent(s.text.trim()) || "…", "{quote}", `[${linkLabel(l)}](${l.url})`);
  }
  const plain = c.links.filter((l) => !linked[l.url]);
  if (plain.length) lines.push("", ...plain.map((l) => `- [${linkLabel(l)}](${l.url})`));
  const attached = c.files.filter((f) => !inline.has(f.id));
  if (attached.length) lines.push("", `Attached: ${attached.map((f) => f.name).join(", ")}`);
  lines.push("", "_Added from Zeff_");
  return lines.join("\n").replace(/^\n+/, "");
}

/** A short fingerprint of what syncing would post (the comment and the file list) — to spot edits since. */
export function jiraSyncHash(c: Pick<ContextItem, "kind" | "title" | "author" | "body" | "links" | "date" | "files" | "ticket">): string {
  const text = `${c.ticket ?? ""}\n${jiraCommentMarkdown(c)}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** Where an item stands with Jira: no ticket, never synced, synced as is, or edited since. */
export type JiraSyncState = "no-ticket" | "unsynced" | "synced" | "changed";

export function jiraSyncState(c: Pick<ContextItem, "kind" | "title" | "author" | "body" | "links" | "date" | "files" | "ticket" | "jiraSyncedAt" | "jiraSyncedHash">): JiraSyncState {
  if (!c.ticket) return "no-ticket";
  // A Jira comment or ticket itself (nothing of its own written): it's in Jira already.
  if (c.kind === "jira" && !c.title?.trim() && !c.body.trim() && !c.files.length) return "no-ticket";
  if (!c.jiraSyncedAt) return "unsynced";
  return c.jiraSyncedHash === jiraSyncHash(c) && c.files.every((f) => f.jiraSyncedAt) ? "synced" : "changed";
}
