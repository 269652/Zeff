import { and, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { GitlabSettings } from "@/db/schema";
import { gitlabLinkKey, type GitlabItemView, type GitlabKind } from "./shared";

const { gitlabItems, gitlabSettings, contexts } = schema;

/** An item as the GitLab driver (src/plugins/gitlab/driver.mjs) reads it. */
export type GitlabItemInput = Omit<GitlabItemView, "inContext">;

export function getGitlabSettings(): GitlabSettings {
  const db = getDb();
  return db.select().from(gitlabSettings).limit(1).get() ?? db.insert(gitlabSettings).values({ id: 1 }).returning().get();
}

export function updateGitlabSettings(patch: Partial<Omit<GitlabSettings, "id">>): GitlabSettings {
  getGitlabSettings(); // ensure the row exists
  return getDb().update(gitlabSettings).set(patch).returning().get();
}

/** Keep what was read (each item replacing its last copy). Returns how many are new and how many there are in all. */
export function saveGitlabItems(list: GitlabItemInput[]): { added: number; total: number } {
  const db = getDb();
  const syncedAt = new Date().toISOString();
  const keys = list.map((i) => i.key).filter(Boolean);
  const known = new Set<string>();
  for (let i = 0; i < keys.length; i += 500) {
    for (const r of db.select({ key: gitlabItems.key }).from(gitlabItems).where(inArray(gitlabItems.key, keys.slice(i, i + 500))).all()) known.add(r.key);
  }
  db.transaction((tx) => {
    for (const i of list) {
      if (!i?.key || !i.url || !["mr", "comment", "branch"].includes(i.kind)) continue;
      const row = {
        kind: i.kind,
        project: String(i.project ?? ""),
        projectUrl: String(i.projectUrl ?? ""),
        ref: String(i.ref ?? ""),
        title: String(i.title ?? ""),
        body: String(i.body ?? ""),
        author: i.author ?? null,
        state: i.state ?? null,
        createdAt: i.createdAt ?? null,
        updatedAt: i.updatedAt ?? i.createdAt ?? null,
        url: String(i.url),
        branch: i.branch ?? null,
        parent: i.parent ?? null,
        thread: i.thread ?? null,
        syncedAt,
      };
      tx.insert(gitlabItems).values({ key: i.key, ...row }).onConflictDoUpdate({ target: gitlabItems.key, set: row }).run();
    }
  });
  const total = db.select({ n: sql<number>`count(*)` }).from(gitlabItems).get()?.n ?? 0;
  return { added: keys.filter((k) => !known.has(k)).length, total: Number(total) };
}

/**
 * A merge request Zeff just opened, kept at once — so the Branches tab, the todos and the badges
 * know it before the next GitLab sync (which then fills in the rest). Kept as it is when known.
 */
export function recordOpenedMr(v: { project: string; iid: number; url: string; title: string; description: string; source: string; author: string | null }): void {
  const key = `mr:${v.project}!${v.iid}`;
  if (getDb().select({ key: gitlabItems.key }).from(gitlabItems).where(eq(gitlabItems.key, key)).get()) return;
  const now = new Date().toISOString();
  saveGitlabItems([
    {
      key,
      kind: "mr",
      project: v.project,
      projectUrl: v.url.replace(/\/-\/merge_requests\/\d+.*$/, ""),
      ref: `!${v.iid}`,
      title: v.title,
      body: v.description,
      author: v.author,
      state: "opened",
      createdAt: now,
      updatedAt: now,
      url: v.url,
      branch: v.source,
      parent: null,
      thread: null,
      resolvedAt: null,
    },
  ]);
}

function toView(r: typeof gitlabItems.$inferSelect, inContext = false): GitlabItemView {
  return {
    key: r.key,
    kind: (["mr", "comment", "branch"].includes(r.kind) ? r.kind : "mr") as GitlabKind,
    project: r.project,
    projectUrl: r.projectUrl,
    ref: r.ref,
    title: r.title,
    body: r.body,
    author: r.author,
    state: r.state,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    url: r.url,
    branch: r.branch,
    parent: r.parent,
    thread: r.thread,
    resolvedAt: r.resolvedAt,
    inContext,
  };
}

/** Items, most recently updated first: of one kind, matching words (title, text, ref, project, author) — and whether each is already context. */
export function listGitlabItems(opts: { q?: string; kind?: GitlabKind; limit?: number } = {}): GitlabItemView[] {
  const limit = Math.min(500, opts.limit ?? 100);
  // A pasted link: what it points at, with its merge request's comments and branch — for a
  // comment that isn't synced (yet), its merge request's at least.
  const link = gitlabLinkKey(opts.q);
  let linked = link ? itemsOfLink(link) : [];
  if (link?.startsWith("note:") && !linked.length) linked = itemsOfLink(gitlabLinkKey(opts.q!.split("#")[0]) ?? "");
  const rows = link ? linked.filter((r) => !opts.kind || r.kind === opts.kind).slice(0, limit) : searchItems(opts.q ?? "", opts.kind, limit);
  // Already context: an item links to it (by its link's key).
  const used = new Set<string>();
  if (rows.length) {
    const linked = getDb().select({ links: contexts.links }).from(contexts).where(like(contexts.links, "%/-/%")).all();
    for (const r of linked) {
      try {
        for (const l of JSON.parse(r.links) as { url?: string }[]) {
          const k = gitlabLinkKey(l?.url);
          if (k) used.add(k);
        }
      } catch {
        // not JSON: skip
      }
    }
  }
  return rows.map((r) => toView(r, used.has(r.key)));
}

/** A bot's account ("Semantic Bot", "release-bot"): its comments are notices ("included in version …"). */
const BOT = sql`(lower(coalesce(${gitlabItems.author}, '')) like '% bot' or lower(coalesce(${gitlabItems.author}, '')) like '%-bot')`;

/** Items matching every word (title, text, ref, project, author), most recently updated first — bots' last. */
function searchItems(q: string, kind: GitlabKind | undefined, limit: number) {
  const conditions = [];
  if (kind) conditions.push(eq(gitlabItems.kind, kind));
  for (const word of q.trim().split(/\s+/).filter(Boolean).slice(0, 6)) {
    const p = `%${word.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    conditions.push(
      or(
        sql`${gitlabItems.title} like ${p} escape '\\'`,
        sql`${gitlabItems.body} like ${p} escape '\\'`,
        sql`${gitlabItems.ref} like ${p} escape '\\'`,
        sql`${gitlabItems.project} like ${p} escape '\\'`,
        sql`${gitlabItems.author} like ${p} escape '\\'`,
      )!,
    );
  }
  return getDb()
    .select()
    .from(gitlabItems)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(BOT, desc(gitlabItems.updatedAt))
    .limit(limit)
    .all();
}

/**
 * What a link (by its key) points at, as far as it's synced: that item first, then its merge
 * request (for a comment's or branch's link), the merge request's comments (newest first) and
 * its branch — what you'd want from a merge request's link.
 */
function itemsOfLink(key: string) {
  const db = getDb();
  const self = db.select().from(gitlabItems).where(eq(gitlabItems.key, key)).get();
  const mr = key.startsWith("mr:") ? key : self?.parent;
  const family = mr ? db.select().from(gitlabItems).where(or(eq(gitlabItems.key, mr), eq(gitlabItems.parent, mr))).all() : [];
  const rank = (r: typeof gitlabItems.$inferSelect) => (r.key === key ? 0 : r.kind === "mr" ? 1 : r.kind === "comment" ? 2 : 3);
  return [...new Map([...(self ? [self] : []), ...family].map((r) => [r.key, r])).values()].sort(
    (a, b) => rank(a) - rank(b) || (b.createdAt ?? "").localeCompare(a.createdAt ?? ""),
  );
}

/** A comment's thread state as GitLab now has it (after Zeff resolved or reopened it there). */
export function setGitlabState(key: string, state: "resolved" | "unresolved"): void {
  getDb().update(gitlabItems).set({ state }).where(eq(gitlabItems.key, key)).run();
}

/**
 * The conversation on these merge requests (by their key, "mr:<project>!<n>"): the comments
 * people wrote (no bots), oldest first — the last `max` of each.
 */
export function conversationsOf(parents: string[], max = 12): Map<string, GitlabItemView[]> {
  const wanted = [...new Set(parents.filter(Boolean))].slice(0, 30);
  const out = new Map<string, GitlabItemView[]>();
  if (!wanted.length) return out;
  const rows = getDb()
    .select()
    .from(gitlabItems)
    .where(and(eq(gitlabItems.kind, "comment"), inArray(gitlabItems.parent, wanted)))
    .orderBy(gitlabItems.createdAt)
    .all()
    .filter((r) => !/(\sbot|-bot)$/i.test((r.author ?? "").trim()));
  for (const r of rows) {
    const list = out.get(r.parent!) ?? [];
    list.push(toView(r));
    out.set(r.parent!, list);
  }
  for (const [k, list] of out) out.set(k, list.slice(-max));
  return out;
}


/** The synced items with these keys, by key. */
export function gitlabItemsByKeys(keys: string[]): Map<string, GitlabItemView> {
  const wanted = [...new Set(keys.filter(Boolean))].slice(0, 50);
  if (!wanted.length) return new Map();
  const rows = getDb().select().from(gitlabItems).where(inArray(gitlabItems.key, wanted)).all();
  return new Map(rows.map((r) => [r.key, toView(r)]));
}

/** How many items there are, by kind. */
/**
 * The comments on each ticket's merge requests (or naming it), newest first — found as Boards
 * runs find them (the key in the title, branch or text), `perTicket` each.
 */
export function gitlabCommentsByTicket(tickets: string[], perTicket = 10, kind: GitlabKind = "comment"): Record<string, GitlabItemView[]> {
  const db = getDb();
  const out: Record<string, GitlabItemView[]> = {};
  for (const key of new Set(tickets)) {
    if (!/^[A-Z][A-Z0-9]+-\d+$/i.test(key)) continue;
    const pattern = `%${key}%`;
    // LIKE finds PROJ-364 for PROJ-36 too: only the key itself.
    const whole = new RegExp(`(^|[^A-Za-z0-9])${key}(?![0-9])`, "i");
    const rows = db
      .select()
      .from(gitlabItems)
      .where(and(eq(gitlabItems.kind, kind), or(like(gitlabItems.title, pattern), like(gitlabItems.branch, pattern), like(gitlabItems.body, pattern))))
      .orderBy(desc(gitlabItems.createdAt))
      .limit(perTicket * 3)
      .all()
      .filter((r) => [r.title, r.branch, r.body].some((s) => whole.test(s ?? "")))
      .slice(0, perTicket);
    if (rows.length) out[key] = rows.map((r) => toView(r));
  }
  return out;
}

export function gitlabItemCounts(): Record<GitlabKind | "all", number> {
  const rows = getDb().select({ kind: gitlabItems.kind, n: sql<number>`count(*)` }).from(gitlabItems).groupBy(gitlabItems.kind).all();
  const by = Object.fromEntries(rows.map((r) => [r.kind, Number(r.n)]));
  return { all: (by.mr ?? 0) + (by.comment ?? 0) + (by.branch ?? 0), mr: by.mr ?? 0, comment: by.comment ?? 0, branch: by.branch ?? 0 };
}
