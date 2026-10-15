/**
 * Branch knowledge: for every todo with a ticket a durable knowledge artifact — the todo and the
 * messages it comes from (Teams, Jira comments, mails) kept as they were, with tags (branch-naming, the
 * ticket, the todo, where it came from) and a short name suggested from the words of the message. It
 * stays when the todo is done and when the message is no longer synced or no longer in the context. A
 * worker (or an agent) that is to name a new branch is given the artifacts of the ticket by their
 * tags, so the name follows what the message was about — short — whatever became of the todo. The
 * artifacts are also exported to the knowledge server (space "Zeff · Branch-Kontext"). Server only.
 */
import { getSqlite } from "@/db";
import { listTodos } from "@/lib/boards/store";
import type { TodoView } from "@/lib/boards/shared";

export const BRANCH_TAG = "branch-naming";
/** At most this many characters for the words after the ticket key in a branch name. */
export const SHORT_NAME_MAX = 24;

type Source = { ref: string; label: string; text: string };
export type BranchArtifact = { id: number; todoId: number; ticket: string; title: string; body: string; tags: string[]; slug: string; sources: Source[]; createdAt: string; updatedAt: string };
type Row = { id: number; todo_id: number; ticket: string; title: string; body: string; tags: string; slug: string; sources: string; created_at: string; updated_at: string };

function db() {
  const d = getSqlite();
  d.exec(`
    create table if not exists branch_knowledge (id integer primary key autoincrement, todo_id integer not null unique, ticket text not null, title text not null, body text not null, tags text not null default '[]', slug text not null default '', sources text not null default '[]', created_at text not null, updated_at text not null);
    create index if not exists branch_knowledge_ticket on branch_knowledge (ticket);
  `);
  return d;
}

const parse = <T>(s: string, d: T): T => {
  try {
    return JSON.parse(s) as T;
  } catch {
    return d;
  }
};
const toArtifact = (r: Row): BranchArtifact => ({ id: r.id, todoId: r.todo_id, ticket: r.ticket, title: r.title, body: r.body, tags: parse<string[]>(r.tags, []), slug: r.slug, sources: parse<Source[]>(r.sources, []), createdAt: r.created_at, updatedAt: r.updated_at });

const STOP = new Set(
  "der die das den dem des ein eine einer einen einem und oder aber ist sind war wird werden wurde nicht kein keine mit von zu zum zur für auf aus bei nach über unter vor als auch noch nur wie was wer wenn dass damit dann doch schon mal bitte bitte mir mich uns ihr wir sie ich du es im in am an um ob so da hier dort muss müssen soll sollen kann können mehr bei the a an and or but is are was be been to of for on in at by with from as it this that these those please can could should would need needs make makes fix todo ticket neue neuen neues ändern anpassen prüfen klären machen einbauen umsetzen kannst kannste könntest koenntest würdest wuerdest hallo hi hey danke gerne mal bitte schau schaust guck sag sagen frage".split(/\s+/),
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
 * A short name for the change from the words of a text: its first meaningful words (no stop words, no
 * ticket keys, no URLs), lower case, joined by hyphens — 2 or 3 of them, at most SHORT_NAME_MAX characters.
 */
export function suggestSlug(text: string): string {
  const words = plain(text.replace(/https?:\/\/\S+/g, " ").replace(/\b[A-Za-z][A-Za-z0-9]+-\d+\b/g, " "))
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w));
  const picked: string[] = [];
  for (const w of words) {
    if (picked.includes(w)) continue;
    const next = [...picked, w].join("-");
    if (next.length > SHORT_NAME_MAX) {
      if (!picked.length) picked.push(w.slice(0, SHORT_NAME_MAX));
      break;
    }
    picked.push(w);
    if (picked.length === 3) break;
  }
  return picked.join("-");
}

const clean = (t: string | null | undefined) => (t ?? "").replace(/\r/g, "").replace(/\s*\n\s*/g, " ").trim();

/** The messages a todo cites, as they are now (Teams message, Jira comment, mail) — what can still be read. */
function sourcesNow(todo: Pick<TodoView, "refs" | "mailRefs">): Source[] {
  const d = getSqlite();
  const out: Source[] = [];
  const get = <T>(sql: string, ...a: unknown[]) => {
    try {
      return d.prepare(sql).get(...a) as T | undefined;
    } catch {
      return undefined;
    }
  };
  for (const ref of new Set([...todo.refs, ...todo.mailRefs])) {
    if (ref.startsWith("teams:")) {
      const m = get<{ sender_name: string | null; place: string | null; sent_at: string; subject: string | null; text: string }>("select sender_name, place, sent_at, subject, text from teams_messages where key = ?", ref.slice(6));
      if (m) out.push({ ref, label: `Teams-Nachricht von ${m.sender_name ?? "?"}${m.place ? ` in „${m.place}“` : ""}, ${m.sent_at.slice(0, 10)}`, text: clean([m.subject, m.text].filter(Boolean).join(" — ")).slice(0, 1200) });
    } else if (ref.startsWith("jira-comment:")) {
      const c = get<{ ticket: string; author: string; at: string; body: string }>("select ticket, author, at, body from jira_comments where id = ?", ref.slice(13));
      if (c) out.push({ ref, label: `Jira-Kommentar von ${c.author} an ${c.ticket}, ${c.at.slice(0, 10)}`, text: clean(c.body).slice(0, 1200) });
    } else if (ref.startsWith("mail:")) {
      const m = get<{ from_name: string | null; subject: string; preview: string; received_at: string }>("select from_name, subject, preview, received_at from emails where key = ?", ref.slice(5));
      if (m) out.push({ ref, label: `Mail von ${m.from_name ?? "?"}, ${m.received_at.slice(0, 10)}`, text: clean(`${m.subject} — ${m.preview}`).slice(0, 1200) });
    }
  }
  return out;
}

function bodyOf(todo: TodoView, sources: Source[], slug: string): string {
  return [
    `Todo ${todo.ref} zu ${todo.ticket}: ${todo.text}`,
    clean(todo.note) && `Notiz: ${clean(todo.note)}`,
    sources.length ? `## Woher das Todo kommt\n${sources.map((s) => `- ${s.label}: „${s.text}“`).join("\n")}` : "",
    slug ? `Kurzname für einen Branch: ${slug}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * The artifact of one todo made or brought up to date. What a source said is kept when it can't be read
 * any more (the message was cleaned out, the comment deleted): the old copy stays. Returns whether it changed.
 */
export function snapshotTodo(todo: TodoView): boolean {
  if (!todo.ticket) return false;
  const d = db();
  const cur = d.prepare("select * from branch_knowledge where todo_id = ?").get(todo.id) as Row | undefined;
  const now = parseSources(cur);
  const fresh = sourcesNow(todo);
  // Fresh ones replace by ref; ones no longer readable stay.
  const merged = [...fresh, ...now.filter((o) => !fresh.some((f) => f.ref === o.ref))];
  // The name follows the todo's words (already boiled down); a message's chatter only when they say too little.
  const own = suggestSlug(todo.text);
  const slug = own.includes("-") ? own : suggestSlug(merged[0]?.text ?? "") || own;
  const kinds = [...new Set(merged.map((s) => s.ref.split(":")[0].replace("jira-comment", "jira")))];
  const tags = [BRANCH_TAG, todo.ticket, todo.ref, todo.kind === "fix" ? "fix" : "feature", ...kinds];
  const title = `${todo.ref} · ${todo.ticket}: ${todo.text.slice(0, 100)}`;
  const body = bodyOf(todo, merged, slug);
  const at = new Date().toISOString();
  if (!cur) {
    d.prepare("insert into branch_knowledge (todo_id, ticket, title, body, tags, slug, sources, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(todo.id, todo.ticket, title, body, JSON.stringify(tags), slug, JSON.stringify(merged), at, at);
    return true;
  }
  if (cur.body === body && cur.title === title && cur.tags === JSON.stringify(tags)) return false;
  d.prepare("update branch_knowledge set ticket = ?, title = ?, body = ?, tags = ?, slug = ?, sources = ?, updated_at = ? where todo_id = ?").run(todo.ticket, title, body, JSON.stringify(tags), slug, JSON.stringify(merged), at, todo.id);
  return true;
}

const parseSources = (r: Row | undefined): Source[] => (r ? parse<Source[]>(r.sources, []) : []);

/** Every todo with a ticket (open or done) gets its artifact — or its update. How many changed. Cheap enough to call often. */
export function ensureBranchKnowledge(): number {
  let changed = 0;
  for (const t of listTodos({ status: "all" })) if (snapshotTodo(t)) changed++;
  return changed;
}

/** The artifacts with a tag (branch-naming by default) of a ticket and of todos (whatever their state), the newest first. */
export function branchKnowledgeFor(v: { ticket?: string | null; todoIds?: number[]; tag?: string; limit?: number }): BranchArtifact[] {
  const tag = v.tag ?? BRANCH_TAG;
  const ticket = (v.ticket ?? "").toUpperCase();
  const ids = new Set(v.todoIds ?? []);
  return (db().prepare("select * from branch_knowledge order by updated_at desc").all() as Row[])
    .map(toArtifact)
    .filter((a) => a.tags.includes(tag) && ((ticket && a.ticket.toUpperCase() === ticket) || ids.has(a.todoId)))
    .slice(0, v.limit ?? 6);
}

/**
 * What a worker is told when it names a branch: the artifacts of the ticket — what the todo and its messages
 * said, even if the todo is done and the message is gone from the context — and the rule for a short name.
 * Empty when there is nothing kept.
 */
export function branchKnowledgeBlock(todo: Pick<TodoView, "id" | "ticket" | "refs" | "mailRefs" | "text" | "kind" | "ref" | "note">): string {
  // Brought up to date first: a message that is still there is kept before it goes.
  try {
    snapshotTodo(todo as TodoView);
  } catch {
    // the block is made from what is kept
  }
  const list = branchKnowledgeFor({ ticket: todo.ticket, todoIds: [todo.id] });
  if (!list.length) return "";
  const lines = list.map((a) => {
    const said = a.sources.map((s) => `  - ${s.label}: „${s.text.slice(0, 300)}“`).join("\n");
    return `- ${a.title}${a.slug ? ` — Kurzname-Vorschlag: \`${a.slug}\`` : ""}${said ? `\n${said}` : ""}`;
  });
  return `\n\n## Wissen zur Branch-Benennung (Tag ${BRANCH_TAG}, ${todo.ticket})\nDas ist festgehalten, worum es bei diesem Ticket ging — auch von erledigten Todos und Nachrichten, die nicht mehr im Kontext stehen. Wähle den Branch-Namen danach: kurz (2–3 Wörter, höchstens ${SHORT_NAME_MAX} Zeichen hinter dem Ticket-Key), nimm einen passenden Kurznamen-Vorschlag oder fasse die Sache selbst knapp.\n${lines.join("\n")}`;
}

/** The artifacts as documents for the knowledge server (its "Zeff" source): one page each, the tags in its text. */
export function branchKnowledgeDocs(zeffUrl: string): { id: string; space: string; title: string; url: string; updatedAt: string | null; author: string | null; body: string }[] {
  ensureBranchKnowledge();
  return (db().prepare("select * from branch_knowledge").all() as Row[]).map(toArtifact).map((a) => ({
    id: `zeff:branchctx:${a.todoId}`,
    space: "Zeff · Branch-Kontext",
    title: `Branch-Kontext ${a.title}`,
    url: `${zeffUrl}/t/${a.todoId}`,
    updatedAt: a.updatedAt,
    author: null,
    body: `Tags: ${a.tags.join(", ")}\n\n${a.body}`,
  }));
}
