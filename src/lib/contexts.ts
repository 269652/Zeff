import fs from "node:fs";
import path from "node:path";
import { and, asc, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import { dataDir, getDb, schema } from "@/db";
import type { Context } from "@/db/schema";
import {
  cleanLinks,
  contextBriefItem,
  isContextKind,
  itemSource,
  jiraSyncHash,
  jiraSyncState,
  normalizeTicket,
  parseLinks,
  type ContextBrief,
  type ContextFileInfo,
  type ContextInput,
  type ContextItem,
  type ContextUse,
} from "./contexts-shared";
import { readInbox } from "./calendar/inbox";
import { resolveLinks } from "./context-links";
import { entityHeadline, entityKey, entityText, entityWhoWhen, type Entity, type EntityMap } from "./entities-shared";
import { teamsDay } from "./teams/shared";
import { NotFoundError, ValidationError } from "./errors";
import { t } from "@/lib/i18n/server";
import { mapImageTargets } from "./markdown";

const { contexts, contextFiles, entryContexts, timeEntries, jobs } = schema;

/** Largest file accepted per upload. */
export const MAX_CONTEXT_FILE_BYTES = 20 * 1024 * 1024;


const LINK_SCHEMES = /^(https?:|mailto:|msteams:|zeff:todo:)/i;

/** Check and tidy what a form posted: a known kind, a real ticket key, safe links, something to say. */
export function validateContextInput(raw: ContextInput, opts: { hasFiles?: boolean } = {}): ContextInput {
  const text = (v: string | null | undefined, max: number) => {
    const s = (v ?? "").trim();
    return s ? s.slice(0, max) : null;
  };
  const links = cleanLinks(raw.links);
  const bad = links.find((l) => !LINK_SCHEMES.test(l.url));
  if (bad) throw new ValidationError(t("“{url}” isn't a web, mail or Teams link.", { url: bad.url }));
  const ticketRaw = (raw.ticket ?? "").trim();
  const ticket = normalizeTicket(ticketRaw);
  if (ticketRaw && !ticket) throw new ValidationError(t("“{ticket}” isn't a Jira ticket key (like PROJ-337).", { ticket: ticketRaw }));
  const date = raw.date?.trim() || null;
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ValidationError(t("The date must be YYYY-MM-DD."));
  const input: ContextInput = {
    kind: isContextKind(raw.kind) ? raw.kind : "note",
    title: text(raw.title, 200),
    author: text(raw.author, 120),
    body: (raw.body ?? "").replace(/\r\n?/g, "\n").trim().slice(0, 100000), // forms post a textarea's lines with \r\n
    links,
    date,
    ticket,
  };
  if (!input.body && !input.title && !input.links.length && !opts.hasFiles) {
    throw new ValidationError(t("Add the message, a title, a link or a file."));
  }
  return input;
}

function filesFor(ids: number[]): Map<number, ContextFileInfo[]> {
  const out = new Map<number, ContextFileInfo[]>();
  if (!ids.length) return out;
  const rows = getDb().select().from(contextFiles).where(inArray(contextFiles.contextId, ids)).orderBy(asc(contextFiles.id)).all();
  for (const r of rows) {
    const list = out.get(r.contextId) ?? [];
    list.push({ id: r.id, name: r.name, mime: r.mime, size: r.size, jiraSyncedAt: r.jiraSyncedAt, storedName: r.path.split("/").pop() || r.name });
    out.set(r.contextId, list);
  }
  return out;
}

function usesFor(ids: number[]): Map<number, ContextUse[]> {
  const out = new Map<number, ContextUse[]>();
  if (!ids.length) return out;
  const rows = getDb()
    .select({
      contextId: entryContexts.contextId,
      id: timeEntries.id,
      date: timeEntries.date,
      hours: timeEntries.hours,
      description: timeEntries.description,
      ticket: timeEntries.ticket,
      jobNumber: jobs.number,
    })
    .from(entryContexts)
    .innerJoin(timeEntries, eq(timeEntries.id, entryContexts.entryId))
    .innerJoin(jobs, eq(jobs.id, timeEntries.jobId))
    .where(inArray(entryContexts.contextId, ids))
    .orderBy(desc(timeEntries.date), desc(timeEntries.id))
    .all();
  for (const { contextId, ...use } of rows) {
    const list = out.get(contextId) ?? [];
    list.push(use);
    out.set(contextId, list);
  }
  return out;
}

function toItems(rows: Context[]): ContextItem[] {
  const ids = rows.map((r) => r.id);
  const files = filesFor(ids);
  const uses = usesFor(ids);
  return rows.map((r) => ({
    id: r.id,
    kind: isContextKind(r.kind) ? r.kind : "note",
    title: r.title,
    author: r.author,
    body: r.body,
    links: parseLinks(r.links),
    date: r.date,
    ticket: r.ticket,
    files: files.get(r.id) ?? [],
    jiraCommentId: r.jiraCommentId,
    jiraSyncedAt: r.jiraSyncedAt,
    jiraSyncedHash: r.jiraSyncedHash,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    entries: uses.get(r.id) ?? [],
  }));
}

/** Context items, newest first (by when they were written), optionally matching a search. */
export function listContexts(opts: { q?: string; limit?: number } = {}): ContextItem[] {
  const q = opts.q?.trim();
  const pattern = q ? `%${q}%` : null;
  const rows = getDb()
    .select()
    .from(contexts)
    .where(
      pattern
        ? or(like(contexts.title, pattern), like(contexts.author, pattern), like(contexts.body, pattern), like(contexts.links, pattern), like(contexts.ticket, pattern))
        : undefined,
    )
    .orderBy(desc(sql`coalesce(${contexts.date}, substr(${contexts.createdAt}, 1, 10))`), desc(contexts.id))
    .limit(opts.limit ?? 200)
    .all();
  return toItems(rows);
}

export function getContextItem(id: number): ContextItem | undefined {
  const row = getDb().select().from(contexts).where(eq(contexts.id, id)).get();
  return row ? toItems([row])[0] : undefined;
}

/** An entry's context items, in its order (as dragged; else as they were added). */
export function contextsForEntry(entryId: number): ContextItem[] {
  const rows = getDb()
    .select({ c: contexts })
    .from(entryContexts)
    .innerJoin(contexts, eq(contexts.id, entryContexts.contextId))
    .where(eq(entryContexts.entryId, entryId))
    .orderBy(asc(entryContexts.position), asc(entryContexts.createdAt), asc(contexts.id))
    .all();
  return toItems(rows.map((r) => r.c));
}

/**
 * Put an entry's context in this order (item ids, as dragged); the ones not named (its notes,
 * when its sources were dragged) follow in their order.
 */
export function reorderEntryContexts(entryId: number, ids: number[]): void {
  const db = getDb();
  const current = db
    .select({ id: entryContexts.contextId })
    .from(entryContexts)
    .where(eq(entryContexts.entryId, entryId))
    .orderBy(asc(entryContexts.position), asc(entryContexts.createdAt), asc(entryContexts.contextId))
    .all()
    .map((r) => r.id);
  const named = ids.filter((id) => current.includes(id));
  const order = [...new Set([...named, ...current.filter((id) => !named.includes(id))])];
  db.transaction((tx) => {
    order.forEach((id, position) =>
      tx.update(entryContexts).set({ position }).where(and(eq(entryContexts.entryId, entryId), eq(entryContexts.contextId, id))).run(),
    );
  });
}

/** For entry lists: which entries have context — how many items, the first one's headline, and each item at a glance. */
export function contextBriefs(entryIds: number[]): Record<number, ContextBrief> {
  const out: Record<number, ContextBrief> = {};
  if (!entryIds.length) return out;
  const rows = getDb()
    .select({ entryId: entryContexts.entryId, c: contexts })
    .from(entryContexts)
    .innerJoin(contexts, eq(contexts.id, entryContexts.contextId))
    .where(inArray(entryContexts.entryId, entryIds))
    .orderBy(asc(entryContexts.position), asc(entryContexts.createdAt), asc(contexts.id))
    .all();
  const full = toItems([...new Map(rows.map((r) => [r.c.id, r.c])).values()]);
  // A source is told by its message / item: who, where, and their words.
  const entities = resolveLinks(full.flatMap((i) => i.links.map((l) => l.url)));
  const briefOf = (i: ContextItem) => {
    const b = contextBriefItem(i, t);
    const source = itemSource(i, entities);
    if (!source) return b;
    const e = entities[source.url];
    const text = entityText(e).replace(/\s+\n/g, "\n").trim();
    return { ...b, headline: entityHeadline(e), excerpt: text.length > 600 ? `${text.slice(0, 598)}…` : text };
  };
  const items = new Map(full.map((i) => [i.id, briefOf(i)]));
  for (const r of rows) {
    const item = items.get(r.c.id)!;
    const b = (out[r.entryId] ??= { count: 0, headline: item.headline, items: [] });
    b.count += 1;
    b.items.push(item);
  }
  return out;
}

const safeName = (name: string) => (name || "file").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").trim().slice(-120) || "file";

/** Store uploaded files with an item (empty file inputs are skipped); returns their ids, in order. */
async function saveFiles(contextId: number, files: File[]): Promise<number[]> {
  const real = files.filter((f) => f && typeof f.arrayBuffer === "function" && f.size > 0);
  checkFiles(real);
  if (!real.length) return [];
  const db = getDb();
  const dir = path.join(dataDir(), "context-files", String(contextId));
  fs.mkdirSync(dir, { recursive: true });
  const ids: number[] = [];
  for (const f of real) {
    const name = safeName(f.name);
    const row = db.insert(contextFiles).values({ contextId, name, mime: f.type || "application/octet-stream", size: f.size, path: "" }).returning().get();
    // On disk — and as its Jira attachment name — without spaces, brackets, ! or |: Jira shows "!name.png!" inline only without them.
    const rel = `context-files/${contextId}/${row.id}-${name.replace(/[\s()[\]!|]+/g, "-")}`;
    fs.writeFileSync(path.join(dataDir(), rel), Buffer.from(await f.arrayBuffer()));
    db.update(contextFiles).set({ path: rel }).where(eq(contextFiles.id, row.id)).run();
    ids.push(row.id);
  }
  return ids;
}

/** Pictures pasted into the message: store each, then point its ![…](paste:token) at the stored file. */
async function savePasted(contextId: number, body: string, pasted: { token: string; file: File }[]): Promise<void> {
  if (!pasted.length) return;
  const stored = new Map<string, number>();
  for (const p of pasted) {
    const [id] = await saveFiles(contextId, [p.file]);
    if (id) stored.set(p.token, id);
  }
  const next = mapImageTargets(body, (target) => {
    const id = target.startsWith("paste:") ? stored.get(target.slice(6)) : undefined;
    return id ? `attachment:${id}` : target;
  });
  if (next !== body) getDb().update(contexts).set({ body: next }).where(eq(contexts.id, contextId)).run();
}

/** Items with nothing written of their own (no headline, no message) — the ones that can be sources — oldest first. */
const unwrittenItems = () =>
  toItems(getDb().select().from(contexts).where(sql`trim(${contexts.body}) = '' and coalesce(trim(${contexts.title}), '') = ''`).orderBy(asc(contexts.id)).all());

/**
 * Which of a source's items is the one (when there are several, from before): the one posted to
 * Jira, then one on entries, then one with a ticket, then the oldest — `ticket` first if given.
 */
const bestSource = (items: ContextItem[], ticket: string | null = null) =>
  [...items].sort((a, b) => {
    const rank = (c: ContextItem) => [c.jiraCommentId && ticket && c.ticket === ticket ? 0 : 1, c.jiraCommentId ? 0 : 1, ticket && c.ticket === ticket ? 0 : 1, c.entries.length ? 0 : 1, c.ticket ? 0 : 1, c.id];
    const [x, y] = [rank(a), rank(b)];
    const i = x.findIndex((v, k) => v !== y[k]);
    return i < 0 ? 0 : x[i] - y[i];
  })[0];

/**
 * The item for a linked source (a link to a synced Teams message or GitLab item): the one there
 * is for that message / item — taken off an entry and added again, it's the same, its Jira
 * comment and ticket kept — else a new one, who and when from the source, on the ticket given.
 * One not posted and on no entry (or with no ticket) takes the ticket given. Linked to the
 * entry when given.
 */
export function addSource(url: string, entity: Entity, opts: { entryId?: number; ticket?: string | null } = {}): ContextItem {
  const db = getDb();
  const u = url.trim();
  const ticket = normalizeTicket(opts.ticket);
  const key = entityKey(entity);
  const candidates = unwrittenItems();
  const linked = resolveLinks(candidates.flatMap((c) => c.links.map((l) => l.url)));
  const found = bestSource(
    candidates.filter((c) => {
      const l = itemSource(c, linked);
      return l && entityKey(linked[l.url]) === key;
    }),
    ticket,
  );
  let id = found?.id;
  if (found && ticket && found.ticket !== ticket && !found.jiraCommentId && (!found.ticket || !found.entries.length)) {
    db.update(contexts).set({ ticket, updatedAt: sql`(CURRENT_TIMESTAMP)` }).where(eq(contexts.id, found.id)).run();
  }
  if (id === undefined) {
    const { author, at } = entityWhoWhen(entity);
    id = db
      .insert(contexts)
      .values({
        kind: entity.source === "todo" || entity.source === "work" ? "note" : entity.source === "jira-comment" ? "jira" : entity.source === "mail" ? "email" : entity.source,
        title: null,
        author: author ?? null,
        body: "",
        links: JSON.stringify([{ url: u, label: null }]),
        date: at ? teamsDay(at) : null,
        ticket,
      })
      .returning()
      .get().id;
  }
  if (opts.entryId !== undefined) linkContext(opts.entryId, id);
  return getContextItem(id)!;
}

/**
 * A source item linking several sources keeps the first; every other one moves to an item of
 * its own (the one there is, when there is one) on the same entries. Whether it split.
 */
function splitSources(c: ContextItem, linked: EntityMap): boolean {
  if (!itemSource(c, linked)) return false;
  const [, ...rest] = c.links.filter((l) => linked[l.url]);
  if (!rest.length) return false;
  for (const l of rest) linkLike(c.id, addSource(l.url, linked[l.url], { ticket: c.ticket }).id);
  const moved = new Set(rest.map((l) => l.url));
  getDb()
    .update(contexts)
    .set({ links: JSON.stringify(c.links.filter((l) => !moved.has(l.url))), updatedAt: sql`(CURRENT_TIMESTAMP)` })
    .where(eq(contexts.id, c.id))
    .run();
  return true;
}

/** Words of three letters or more, pictures and link targets left out. */
const wordsOf = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .replace(/!\[[^\]]*\]\([^)]*\)|\[([^\]]*)\]\([^)]*\)|https?:\S+/g, "$1")
      .match(/[\p{L}\p{N}]{3,}/gu) ?? [],
  );

/** Whether what an item says is (nearly) all its source's own words — the old form copied them in. */
function copiesSource(c: ContextItem, e: Entity): boolean {
  const own = wordsOf(`${c.title ?? ""} ${c.body}`);
  const theirs = wordsOf(`${entityHeadline(e)} ${entityText(e)}`);
  return own.size > 0 && [...own].filter((w) => theirs.has(w)).length >= 0.9 * own.size;
}

/**
 * One source, one item — for items made before that held: (1) a Teams or GitLab item that just
 * copied its source's words becomes that source (no headline or message of its own; posted to
 * Jira, it stays "synced"); (2) a source item linking several keeps the first, the others move
 * to items of their own; (3) items for the same source become one — the one posted to Jira
 * first — on all their entries. Runs at startup; safe to run again.
 */
export function unifySources(): { copies: number; split: number; merged: number } {
  const db = getDb();
  const load = () => toItems(db.select().from(contexts).orderBy(asc(contexts.id)).all());
  let all = load();
  const linked = resolveLinks(all.flatMap((c) => c.links.map((l) => l.url)));
  const out = { copies: 0, split: 0, merged: 0 };

  for (const c of all) {
    const [l, ...more] = c.links.filter((x) => linked[x.url]);
    if (!l || more.length || c.files.length || (c.kind !== "teams" && c.kind !== "gitlab")) continue;
    if (!copiesSource(c, linked[l.url])) continue;
    const synced = jiraSyncState(c) === "synced";
    db.update(contexts)
      .set({
        title: null,
        body: "",
        updatedAt: sql`(CURRENT_TIMESTAMP)`,
        // What's on Jira says the same — no "changed since" for that.
        ...(synced ? { jiraSyncedHash: jiraSyncHash({ ...c, title: null, body: "" }) } : {}),
      })
      .where(eq(contexts.id, c.id))
      .run();
    out.copies++;
  }
  if (out.copies) all = load();

  for (const c of all) if (splitSources(c, linked)) out.split++;
  if (out.split) all = load();

  out.merged = mergeSources(all, linked).size;
  return out;
}

/**
 * Items for the same source become one (see bestSource: the one posted to Jira first), on all
 * their entries, in their places there. Which went into which (id → id).
 */
function mergeSources(all: ContextItem[], linked: EntityMap): Map<number, number> {
  const groups = new Map<string, ContextItem[]>();
  for (const c of all) {
    const l = itemSource(c, linked);
    if (!l) continue;
    const key = entityKey(linked[l.url]);
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  const merged = new Map<number, number>();
  for (const group of groups.values()) {
    const keep = bestSource(group);
    for (const c of group) {
      if (c === keep || c.jiraCommentId) continue; // a comment posted to Jira stays tracked
      linkLike(c.id, keep.id);
      deleteContext(c.id);
      merged.set(c.id, keep.id);
    }
  }
  return merged;
}

/** Put item `to` on the entries item `from` is on, each in `from`'s place there (right after it). */
function linkLike(from: number, to: number): void {
  const db = getDb();
  for (const r of db.select().from(entryContexts).where(eq(entryContexts.contextId, from)).all()) {
    db.insert(entryContexts).values({ entryId: r.entryId, contextId: to, position: r.position }).onConflictDoNothing().run();
  }
}

/** Files over the size limit are refused. */
function checkFiles(files: File[]): void {
  const tooBig = files.find((f) => f && f.size > MAX_CONTEXT_FILE_BYTES);
  if (tooBig) throw new ValidationError(t("{name} is larger than {mb} MB.", { name: tooBig.name, mb: MAX_CONTEXT_FILE_BYTES / 1024 / 1024 }));
}

/**
 * New context: each linked source (a synced Teams message or GitLab item) is an item of its
 * own — the one there is for it, else a new one on the ticket — and what's written (headline,
 * message, other links, files) one more item, when there is any. All linked to the entry when
 * given. Returns that written item, else the first source's.
 */
export async function createContext(
  raw: ContextInput,
  files: File[] = [],
  entryId?: number,
  pasted: { token: string; file: File }[] = [],
): Promise<ContextItem> {
  const hasFiles = files.some((f) => f && f.size > 0) || pasted.length > 0;
  // All checked before anything is saved: the links, the ticket (the sources go on it too), the files.
  const input = validateContextInput(raw, { hasFiles });
  checkFiles([...files, ...pasted.map((p) => p.file)]);
  const linked = resolveLinks(input.links.map((l) => l.url));
  const sources = input.links.filter((l) => linked[l.url]).map((l) => addSource(l.url, linked[l.url], { entryId, ticket: input.ticket }));
  const note = { ...input, links: input.links.filter((l) => !linked[l.url]) };
  if (sources.length && !note.title && !note.body && !note.links.length && !hasFiles) return sources[0];
  const row = getDb()
    .insert(contexts)
    .values({ ...note, links: JSON.stringify(note.links) })
    .returning()
    .get();
  try {
    await saveFiles(row.id, files);
    await savePasted(row.id, note.body, pasted);
    if (entryId !== undefined) linkContext(entryId, row.id);
  } catch (err) {
    deleteContext(row.id); // no half-saved item (or stray files) left behind
    throw err;
  }
  return getContextItem(row.id)!;
}

/**
 * Change an item (and add files). Moving it to another Jira ticket forgets the old sync, so
 * "Sync to Jira" posts it afresh on the new ticket.
 */
export async function updateContext(id: number, raw: ContextInput, files: File[] = [], pasted: { token: string; file: File }[] = []): Promise<ContextItem> {
  const existing = getContextItem(id);
  if (!existing) throw new NotFoundError(t("Context #{id} not found.", { id }));
  const input = validateContextInput(raw, { hasFiles: existing.files.length > 0 || files.some((f) => f && f.size > 0) || pasted.length > 0 });
  const db = getDb();
  const moved = input.ticket !== existing.ticket;
  db.update(contexts)
    .set({
      ...input,
      links: JSON.stringify(input.links),
      updatedAt: sql`(CURRENT_TIMESTAMP)`,
      ...(moved ? { jiraCommentId: null, jiraSyncedAt: null, jiraSyncedHash: null } : {}),
    })
    .where(eq(contexts.id, id))
    .run();
  if (moved) db.update(contextFiles).set({ jiraSyncedAt: null }).where(eq(contextFiles.contextId, id)).run();
  await saveFiles(id, files);
  await savePasted(id, input.body, pasted);
  // Down to its links, it's a source: one item per source and ticket, as everywhere.
  const item = getContextItem(id)!;
  if (!itemSource(item, resolveLinks(item.links.map((l) => l.url)))) return item;
  splitSources(item, resolveLinks(item.links.map((l) => l.url)));
  const all = unwrittenItems();
  const into = mergeSources(all, resolveLinks(all.flatMap((c) => c.links.map((l) => l.url)))).get(id);
  return getContextItem(into ?? id)!;
}

/** Delete an item everywhere (its links to entries and its files go with it). */
export function deleteContext(id: number): void {
  getDb().delete(contexts).where(eq(contexts.id, id)).run();
  fs.rmSync(path.join(dataDir(), "context-files", String(id)), { recursive: true, force: true });
}

export function linkContext(entryId: number, contextId: number): void {
  const db = getDb();
  if (!db.select({ id: timeEntries.id }).from(timeEntries).where(eq(timeEntries.id, entryId)).get()) {
    throw new NotFoundError(t("Time entry #{id} not found.", { id: entryId }));
  }
  if (!db.select({ id: contexts.id }).from(contexts).where(eq(contexts.id, contextId)).get()) {
    throw new NotFoundError(t("Context #{id} not found.", { id: contextId }));
  }
  // Last on the entry (already on it: it stays where it is).
  const last = db.select({ p: sql<number | null>`max(${entryContexts.position})` }).from(entryContexts).where(eq(entryContexts.entryId, entryId)).get()?.p;
  db.insert(entryContexts).values({ entryId, contextId, position: last == null ? 0 : last + 1 }).onConflictDoNothing().run();
}

export function unlinkContext(entryId: number, contextId: number): void {
  getDb()
    .delete(entryContexts)
    .where(sql`${entryContexts.entryId} = ${entryId} and ${entryContexts.contextId} = ${contextId}`)
    .run();
}

/** A colleague to suggest for "Who", with where Zeff knows them from. */
export type ContextPerson = { name: string; hint: string };

/**
 * Colleagues for the "Who" autocomplete: authors of earlier context items first, then
 * meeting organizers (the synced calendar), Jira assignees and Roar approvers — most
 * frequent first. Mailboxes, team calendars and "Unassigned" are left out.
 */
export function listContextPeople(): ContextPerson[] {
  const db = getDb();
  const people = new Map<string, { name: string; score: number; from: Set<string> }>();
  const add = (raw: string | null | undefined, score: number, from: string) => {
    const name = (raw ?? "").trim().replace(/\s+/g, " ");
    if (!name || name.length > 80 || /[@_]|calendar|unassigned|communit/i.test(name)) return;
    const key = name.toLowerCase();
    const p = people.get(key) ?? { name, score: 0, from: new Set<string>() };
    p.score += score;
    p.from.add(from);
    people.set(key, p);
  };
  for (const r of db.select({ name: contexts.author, n: sql<number>`count(*)` }).from(contexts).groupBy(contexts.author).all()) {
    add(r.name, 100 * r.n, r.n === 1 ? t("in 1 context item") : t("in {n} context items", { n: r.n }));
  }
  for (const e of readInbox()) add(e.organizer?.emailAddress?.name, 3, t("meeting organizer"));
  for (const r of db.select({ name: schema.jiraTickets.assignee, n: sql<number>`count(*)` }).from(schema.jiraTickets).groupBy(schema.jiraTickets.assignee).all()) {
    add(r.name, r.n, t("Jira assignee"));
  }
  for (const r of db.selectDistinct({ name: schema.roarEntries.approver }).from(schema.roarEntries).all()) add(r.name, 10, t("Roar approver"));
  return [...people.values()]
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, 300)
    .map((p) => ({ name: p.name, hint: [...p.from].slice(0, 2).join(" · ") }));
}

/** A stored file: where it is on disk, and what to call and serve it as. */
export function contextFileOnDisk(fileId: number): { absPath: string; name: string; mime: string; contextId: number } | undefined {
  const row = getDb().select().from(contextFiles).where(eq(contextFiles.id, fileId)).get();
  if (!row || !row.path) return undefined;
  return { absPath: path.join(dataDir(), row.path), name: row.name, mime: row.mime, contextId: row.contextId };
}

export function deleteContextFile(fileId: number): void {
  const file = contextFileOnDisk(fileId);
  getDb().delete(contextFiles).where(eq(contextFiles.id, fileId)).run();
  if (file) fs.rmSync(file.absPath, { force: true });
}

/** Note a sync: the comment it was posted as and the fingerprint of what was posted. */
export function markContextSynced(id: number, commentId: string | null, hash: string): void {
  getDb()
    .update(contexts)
    .set({ jiraCommentId: commentId, jiraSyncedAt: new Date().toISOString(), jiraSyncedHash: hash })
    .where(eq(contexts.id, id))
    .run();
}

export function markFilesSynced(fileIds: number[]): void {
  if (!fileIds.length) return;
  getDb().update(contextFiles).set({ jiraSyncedAt: new Date().toISOString() }).where(inArray(contextFiles.id, fileIds)).run();
}
