/**
 * Branch knowledge: the few things worth knowing when a branch is named, kept as knowledge artifacts tagged
 * `branch-naming`. The AI of the briefing writes them while it reads the messages and writes the todos
 * (BoardResult.branchKnowledge): what code change a message asks for ("Footer-Link einrücken") — kind "change" —
 * or how branches are to be named ("nach dem Code Change, nicht nach dem Ticket-Titel") — kind "rule" —, each with
 * the message it comes from, kept as it was said, so it stays when the message is gone from the sync or the
 * context. Nothing else goes into the naming (the settings: branch-naming.ts); the artifacts are also exported to
 * the knowledge server ("Zeff · Branch-Kontext"). Server only.
 */
import { getSqlite } from "@/db";

export const BRANCH_TAG = "branch-naming";
/** The default for the characters after the ticket key in a branch name (the settings change it). */
export const SHORT_NAME_MAX = 24;

export type Source = { ref: string; label: string; text: string };
export type ArtifactKind = "change" | "rule";
export type BranchArtifact = { id: number; ticket: string; kind: ArtifactKind; text: string; source: Source | null; tags: string[]; createdAt: string };
type Row = { id: number; ticket: string; kind: string; text: string; source: string | null; created_at: string };

function db() {
  const d = getSqlite();
  d.exec("create table if not exists branch_artifacts (id integer primary key autoincrement, ticket text not null, kind text not null, text text not null, source text, created_at text not null)");
  return d;
}

const clean = (t: string | null | undefined) => (t ?? "").replace(/\r/g, "").replace(/\s*\n\s*/g, " ").trim();
const projectOf = (ticket: string) => ticket.trim().toUpperCase().split("-")[0];

const toArtifact = (r: Row): BranchArtifact => ({
  id: r.id,
  ticket: r.ticket,
  kind: r.kind === "rule" ? "rule" : "change",
  text: r.text,
  source: (() => {
    try {
      return r.source ? (JSON.parse(r.source) as Source) : null;
    } catch {
      return null;
    }
  })(),
  tags: [BRANCH_TAG, r.kind === "rule" ? "convention" : "change", r.ticket],
  createdAt: r.created_at,
});

/** One message by its ref (teams:<key>, jira-comment:<id>, mail:<key>), as it is now — null when it can't be read any more. */
export function readSource(ref: string): Source | null {
  const d = getSqlite();
  const get = <T>(sql: string, ...a: unknown[]) => {
    try {
      return d.prepare(sql).get(...a) as T | undefined;
    } catch {
      return undefined;
    }
  };
  if (ref.startsWith("teams:")) {
    const m = get<{ sender_name: string | null; place: string | null; sent_at: string; subject: string | null; text: string }>("select sender_name, place, sent_at, subject, text from teams_messages where key = ?", ref.slice(6));
    if (m) return { ref, label: `Teams-Nachricht von ${m.sender_name ?? "?"}${m.place ? ` in „${m.place}“` : ""}, ${m.sent_at.slice(0, 10)}`, text: clean([m.subject, m.text].filter(Boolean).join(" — ")).slice(0, 1200) };
  } else if (ref.startsWith("jira-comment:")) {
    const c = get<{ ticket: string; author: string; at: string; body: string }>("select ticket, author, at, body from jira_comments where id = ?", ref.slice(13));
    if (c) return { ref, label: `Jira-Kommentar von ${c.author} an ${c.ticket}, ${c.at.slice(0, 10)}`, text: clean(c.body).slice(0, 1200) };
  } else if (ref.startsWith("mail:")) {
    const m = get<{ from_name: string | null; subject: string; preview: string; received_at: string }>("select from_name, subject, preview, received_at from emails where key = ?", ref.slice(5));
    if (m) return { ref, label: `Mail von ${m.from_name ?? "?"}, ${m.received_at.slice(0, 10)}`, text: clean(`${m.subject} — ${m.preview}`).slice(0, 1200) };
  }
  return null;
}

/**
 * An artifact kept: `text` (one sentence, or a few words for a change), the ticket it came up on and the message
 * (ref) it comes from — read and kept as it is now. The same text for the same ticket and kind once. Returns the id, or
 * null when it was there (or empty).
 */
export function addArtifact(v: { ticket: string; kind: ArtifactKind; text: string; ref?: string | null }): number | null {
  const ticket = v.ticket.trim().toUpperCase();
  const text = clean(v.text).slice(0, 400);
  if (!ticket || !text) return null;
  const d = db();
  const kind = v.kind === "rule" ? "rule" : "change";
  if (d.prepare("select 1 from branch_artifacts where ticket = ? and kind = ? and lower(text) = lower(?)").get(ticket, kind, text)) return null;
  const source = v.ref ? readSource(v.ref.trim()) : null;
  const r = d.prepare("insert into branch_artifacts (ticket, kind, text, source, created_at) values (?, ?, ?, ?, ?)").run(ticket, kind, text, source ? JSON.stringify(source) : null, new Date().toISOString());
  return Number(r.lastInsertRowid);
}

/** What the briefing's AI wrote per ticket (BoardResult.branchKnowledge), kept. How many were new. */
export function keepFromBriefing(tickets: { key: string; branchKnowledge?: { kind: ArtifactKind; text: string; ref?: string }[] }[]): number {
  let n = 0;
  for (const t of tickets) for (const b of t.branchKnowledge ?? []) if (addArtifact({ ticket: t.key, kind: b.kind, text: b.text, ref: b.ref })) n++;
  return n;
}

export const listArtifacts = (): BranchArtifact[] => (db().prepare("select * from branch_artifacts order by id desc").all() as Row[]).map(toArtifact);
export const deleteArtifact = (id: number) => void db().prepare("delete from branch_artifacts where id = ?").run(id);

/**
 * What applies when a branch for this ticket is named: its own changes, and the rules of its project (a rule
 * said on "PROJ-364" counts for "PROJ-306"). The newest first.
 */
export function artifactsFor(ticket: string, limit = 8): BranchArtifact[] {
  const key = ticket.trim().toUpperCase();
  if (!key) return [];
  return listArtifacts()
    .filter((a) => (a.kind === "rule" ? projectOf(a.ticket) === projectOf(key) : a.ticket === key))
    .slice(0, limit);
}

const STOP = new Set(
  "der die das den dem des ein eine einer einen einem und oder aber ist sind war wird werden wurde nicht kein keine mit von zu zum zur für auf aus bei nach über unter vor als auch noch nur wie was wer wenn dass damit dann doch schon mal bitte mir mich uns ihr wir sie ich du es im in am an um ob so da hier dort muss müssen soll sollen kann können mehr the a an and or but is are was be been to of for on in at by with from as it this that these those please can could should would need needs make makes fix todo ticket neue neuen neues ändern anpassen prüfen klären machen einbauen umsetzen kannst kannste könntest hallo hi hey danke gerne".split(/\s+/),
);

const plain = (s: string) =>
  s
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/\p{M}/gu, "");

/**
 * A short name from the words of a change ("Footer-Link im Newsletter einrücken" → "footer-link-newsletter"): its first
 * meaningful words (no stop words, ticket keys or links), lower case, joined by hyphens — as many as `maxWords`, at most
 * `max` characters (the settings: Prompts → Branch names).
 */
export function suggestSlug(text: string, max = SHORT_NAME_MAX, maxWords = 3): string {
  const words = plain(text.replace(/https?:\/\/\S+/g, " ").replace(/\b[A-Za-z][A-Za-z0-9]+-\d+\b/g, " "))
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w));
  const picked: string[] = [];
  for (const w of words) {
    if (picked.includes(w)) continue;
    if ([...picked, w].join("-").length > max) {
      if (!picked.length) picked.push(w.slice(0, max));
      break;
    }
    picked.push(w);
    if (picked.length >= maxWords) break;
  }
  return picked.join("-");
}

/** The artifacts as documents for the knowledge server (its "Zeff" source): a page each, the tags in its text. */
export function branchKnowledgeDocs(zeffUrl: string): { id: string; space: string; title: string; url: string; updatedAt: string | null; author: string | null; body: string }[] {
  return listArtifacts().map((a) => ({
      id: `zeff:branchctx:${a.id}`,
      space: "Zeff · Branch-Kontext",
      title: `${a.kind === "rule" ? "Branch-Regel" : "Code Change"} ${a.ticket}: ${a.text.slice(0, 90)}`,
      url: `${zeffUrl}/settings/ai#branchname`,
      updatedAt: a.createdAt,
      author: null,
      body: `Tags: ${a.tags.join(", ")}\n\n${a.text}${a.source ? `\n\n## Woher\n- ${a.source.label}: „${a.source.text}“` : ""}`,
    }));
}
