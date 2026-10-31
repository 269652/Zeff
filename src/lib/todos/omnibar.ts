import { docsByRefs } from "@/plugins/documents/store";
import { noteBriefsByRefs } from "@/plugins/keep/boards";
import { SEARCHERS, type Candidate } from "@/lib/rag";
import { getJiraTicket } from "@/lib/jira/store";
import { TODO_KIND_LABELS, type TodoView } from "./shared";

/**
 * The todo omnibar: type anything and get the things it names — tickets, mails, Teams messages, Jira and GitLab
 * comments, notes, documents, people, the todos' own words — each with the todos it belongs to. Picking one filters
 * the lists to exactly those todos, so a mail that three todos cite shows all three, a ticket shows all its todos.
 * Pure over what it is given (the todos, a lookup for each source), so tests give their own.
 */

export type OmniKind = "text" | "ticket" | "todo" | "note" | "mail" | "teams" | "jira" | "gitlab" | "context" | "fact" | "doc" | "keep" | "person" | "kind";

export type OmniHit = {
  /** What a chip is keyed by (the same hit again isn't added twice). */
  key: string;
  kind: OmniKind;
  title: string;
  sub: string;
  /** The todos it belongs to (never empty — a hit nothing refers to isn't offered). */
  todoIds: number[];
};

export type OmniDeps = {
  /** The sources' own searchers (default: those of the retrieval, over what Zeff keeps). */
  searchers?: Partial<Record<keyof typeof SEARCHERS, (words: string[], q: string) => Promise<Candidate[]> | Candidate[]>>;
  /** Documents and Keep notes by their refs (default: the stores). */
  docs?: (refs: string[]) => Map<string, { name: string; abstract: string }>;
  keep?: (refs: string[]) => Map<string, { title: string; text: string }>;
  ticketSummary?: (key: string) => string;
  people?: { id: number; name: string; aliases: string[] }[];
};

const lower = (s: string | null | undefined) => (s ?? "").toLowerCase();
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
const wordsOf = (q: string) => [...new Set(lower(q).split(/[^\p{L}\p{N}_#-]+/u).filter((w) => w.length >= 2))].slice(0, 6);
const matches = (hay: string, words: string[]) => words.every((w) => hay.includes(w));
const count = (n: number) => `${n}`;

const SOURCE_KIND: Record<string, OmniKind> = { mails: "mail", teams: "teams", jira: "jira", gitlab: "gitlab", notes: "context", facts: "fact" };

/** A candidate's ref → the todos citing it (`mail:KEY`, `jira-comment:ID`, `teams:KEY`, `gitlab:KEY`, `fact:ID`; a ticket key → its todos). */
function citing(todos: TodoView[], ref: string): number[] {
  if (/^[A-Z][A-Z0-9]+-\d+$/.test(ref)) return todos.filter((t) => t.ticket === ref || t.alsoTickets.includes(ref)).map((t) => t.id);
  return todos.filter((t) => t.refs.includes(ref) || t.mailRefs.includes(ref)).map((t) => t.id);
}

export async function omniSearch(q: string, todos: TodoView[], deps: OmniDeps = {}): Promise<OmniHit[]> {
  const words = wordsOf(q);
  if (!words.length || q.trim().length < 2) return [];
  const hits: OmniHit[] = [];
  const add = (h: OmniHit) => {
    if (h.todoIds.length && !hits.some((x) => x.key === h.key)) hits.push({ ...h, todoIds: [...new Set(h.todoIds)] });
  };
  const ids = (list: TodoView[]) => list.map((t) => t.id);

  // Tickets: by key or summary.
  const tickets = [...new Set(todos.flatMap((t) => [t.ticket, ...t.alsoTickets]).filter(Boolean))];
  const summary = deps.ticketSummary ?? ((k: string) => getJiraTicket(k)?.summary ?? "");
  for (const key of tickets) {
    const s = summary(key);
    if (matches(`${lower(key)} ${lower(s)}`, words)) add({ key: `ticket:${key}`, kind: "ticket", title: `${key}${s ? ` · ${clip(s, 90)}` : ""}`, sub: "", todoIds: ids(todos.filter((t) => t.ticket === key || t.alsoTickets.includes(key))) });
  }

  // What kind of todo (Test, Implement …).
  for (const [kind, label] of Object.entries(TODO_KIND_LABELS)) if (matches(lower(label), words) || (words.length === 1 && lower(kind) === words[0])) add({ key: `kind:${kind}`, kind: "kind", title: label, sub: "", todoIds: ids(todos.filter((t) => t.kind === kind)) });

  // The todos' own words: the todo itself, its notes, its plan and draft.
  for (const t of todos) {
    if (matches(lower(`${t.ref} ${t.text}`), words)) add({ key: `todo:${t.id}`, kind: "todo", title: `${t.ref} · ${clip(t.text, 110)}`, sub: t.ticket, todoIds: [t.id] });
    for (const n of t.userNotes) if (matches(lower(n.text), words)) add({ key: `note:${t.id}:${n.at}`, kind: "note", title: clip(n.text.replace(/\s+/g, " "), 120), sub: `${n.by ?? "Notiz"} · ${t.ref}`, todoIds: [t.id] });
    const planned = t.planned.flatMap((p) => p.steps.map((s) => s.text));
    const step = planned.find((s) => matches(lower(s), words));
    if (step) add({ key: `plan:${t.id}:${step.slice(0, 40)}`, kind: "todo", title: clip(step, 120), sub: `geplant · ${t.ref}`, todoIds: [t.id] });
    if (t.draft && matches(lower(t.draft), words)) add({ key: `draft:${t.id}`, kind: "note", title: clip(t.draft.replace(/\s+/g, " "), 120), sub: `Entwurf · ${t.ref}`, todoIds: [t.id] });
  }

  // What the todos cite: mails, messages, comments, notes, facts — found where Zeff keeps them, offered only if a todo cites them.
  const searchers = { ...SEARCHERS, ...(deps.searchers ?? {}) };
  const sourceWords = words.filter((w) => w.length >= 3);
  if (sourceWords.length) {
    for (const [source, search] of Object.entries(searchers)) {
      if (source === "todos") continue;
      let found: Candidate[] = [];
      try {
        found = await search(sourceWords, q);
      } catch {
        found = [];
      }
      for (const c of found.sort((a, b) => b.score - a.score).slice(0, 60)) {
        if (c.score < Math.min(sourceWords.length, 2)) continue;
        const todoIds = citing(todos, c.ref);
        if (todoIds.length) add({ key: c.ref, kind: SOURCE_KIND[source] ?? "context", title: clip(c.title, 120), sub: [c.when, clip(c.text, 80)].filter(Boolean).join(" · "), todoIds });
      }
    }
  }

  // Documents and Keep notes the todos hold.
  const refsOf = (prefix: string) => [...new Set(todos.flatMap((t) => t.refs.filter((r) => r.startsWith(prefix))))];
  const docRefs = refsOf("doc:");
  if (docRefs.length) {
    const docs = deps.docs ? deps.docs(docRefs) : docsByRefs(docRefs);
    for (const [ref, d] of docs) if (matches(lower(`${d.name} ${d.abstract}`), words)) add({ key: ref, kind: "doc", title: d.name, sub: clip(d.abstract, 80), todoIds: citing(todos, ref) });
  }
  const keepRefs = refsOf("keep:");
  if (keepRefs.length) {
    const notes = deps.keep ? deps.keep(keepRefs) : noteBriefsByRefs(keepRefs);
    for (const [ref, n] of notes) if (matches(lower(`${n.title} ${n.text}`), words)) add({ key: ref, kind: "keep", title: n.title || clip(n.text, 80), sub: clip(n.text, 80), todoIds: citing(todos, ref) });
  }

  // People: whose name (or alias) is in the todos' words.
  for (const p of deps.people ?? []) {
    const names = [p.name, ...p.aliases].filter((n) => n.length >= 3);
    if (!names.some((n) => matches(lower(n), words))) continue;
    const mention = (t: TodoView) => {
      const hay = lower(`${t.text} ${t.note ?? ""} ${t.userNotes.map((n) => n.text).join(" ")}`);
      return names.some((n) => hay.includes(lower(n)));
    };
    add({ key: `person:${p.id}`, kind: "person", title: p.name, sub: "", todoIds: ids(todos.filter(mention)) });
  }

  // Everything the words are in, together — first, so Enter takes it.
  const all = [...new Set(hits.flatMap((h) => h.todoIds))];
  const text: OmniHit[] = all.length ? [{ key: `text:${q.trim().toLowerCase()}`, kind: "text", title: `„${q.trim()}“`, sub: count(all.length), todoIds: all }] : [];
  const order: OmniKind[] = ["ticket", "kind", "person", "todo", "note", "mail", "teams", "jira", "gitlab", "context", "keep", "doc", "fact"];
  const perKind = new Map<OmniKind, number>();
  const sorted = hits
    .sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))
    .filter((h) => {
      const n = (perKind.get(h.kind) ?? 0) + 1;
      perKind.set(h.kind, n);
      return n <= 6;
    });
  return [...text, ...sorted];
}
