import "@/plugins/contributions";
import { getSqlite } from "@/db";
import { currentAccountId, withAccount } from "@/db/accounts";
import { onChange } from "@/lib/events";
import { t } from "@/lib/i18n/server";
import { keepParts, rowPartSource, type WsBadgeConfig } from "./badge-config";
import { getWsBadges } from "./badge-config-store";
import { badgeOf, noBadges, sumBadges, type Badge, type BadgePart, type PageBadges } from "./badge-shared";
import type { DocNode } from "./doc";
import { rowBadgeSources } from "./row-badge-point";
import { unreadCounts } from "./store";

/**
 * The badges of the Workspace tree (badge-shared.ts), on the server: a page's widgets (each widget's `badge`, made of its kept data),
 * a mail or chat database's unread rows, the rows that need you (a date set to remind, past or near; what a plugin says about the rows
 * its source brought — People's person rows) adding up into their database, and a dot where a sync or an agent changed something
 * since you last opened it. The tree is drawn on every Workspace page: everything but the dots is worked out at most every few
 * seconds (again sooner only after a change) and kept per account; the dots are held against when each page was opened, at read.
 * Never an AI. Server only.
 */

/** Kept at least this long (a burst of changes is one reading) … */
const MIN_MS = 10000;
/** … and, with no change since, this long. */
const MAX_MS = 60000;
/** The activity read: the newest lines of the history, of the last days. */
const ACTIVITY_LINES = 20000;
const ACTIVITY_DAYS = 7;

type Kept = PageBadges & { at: number; /** Changed by a source or an agent: by page (a database: its rows), how many lines, the newest when. */ activity: Map<number, { n: number; last: string }> };

const state = globalThis as { __zeffBadges?: Map<string, Kept>; __zeffBadgesBusy?: Map<string, Promise<Kept>>; __zeffBadgesChanged?: number; __zeffBadgesHooked?: boolean };
const kept = (state.__zeffBadges ??= new Map());
const busy = (state.__zeffBadgesBusy ??= new Map());

/** A change anywhere (a sync's rows, a todo ticked, a page saved): the next reading is new (once it is a few seconds old). */
function hook(): void {
  if (state.__zeffBadgesHooked) return;
  state.__zeffBadgesHooked = true;
  onChange((topic) => {
    if (topic === "workspace" || topic === "todos" || topic === "sync" || topic === "attention") state.__zeffBadgesChanged = Date.now();
  });
}

const fresh = (k: Kept) => Date.now() - k.at < MIN_MS || (Date.now() - k.at < MAX_MS && (state.__zeffBadgesChanged ?? 0) < k.at);

/** The widgets on the tree's pages, by page — read again only when a page changed (its count and newest change say so). */
type WidgetUse = { page: number; widget: string; config: Record<string, unknown> };
const indexState = globalThis as { __zeffBadgeWidgets?: Map<string, { sig: string; uses: WidgetUse[] }> };
const widgetIndex = (indexState.__zeffBadgeWidgets ??= new Map());

function widgetUses(): WidgetUse[] {
  const d = getSqlite();
  const s = d.prepare("select count(*) n, max(updated_at) m from ws_pages where db_id is null").get() as { n: number; m: string | null };
  const sig = `${s.n}:${s.m ?? ""}`;
  const key = currentAccountId();
  const hit = widgetIndex.get(key);
  if (hit?.sig === sig) return hit.uses;
  const uses: WidgetUse[] = [];
  const pages = d.prepare("select id, content from ws_pages where db_id is null and archived_at is null and template = 0 and instr(content, '\"zeffWidget\"') > 0").all() as { id: number; content: string }[];
  for (const p of pages) {
    const walk = (n: DocNode) => {
      if (n.type === "zeffWidget" && typeof n.attrs?.widget === "string") {
        let config: Record<string, unknown> = {};
        try {
          config = JSON.parse(String(n.attrs.config ?? "{}")) as Record<string, unknown>;
        } catch {
          // its defaults
        }
        uses.push({ page: p.id, widget: n.attrs.widget, config });
      }
      (n.content ?? []).forEach(walk);
    };
    try {
      ((JSON.parse(p.content) as { content?: DocNode[] }).content ?? []).forEach(walk);
    } catch {
      // a page that does not read: no widgets
    }
  }
  widgetIndex.set(key, { sig, uses });
  return uses;
}

/** The widgets' parts, by page. A widget that fails or has no badge adds nothing. */
async function widgetParts(config: WsBadgeConfig): Promise<Map<number, BadgePart[]>> {
  const out = new Map<number, BadgePart[]>();
  if (!config.sources.widgets) return out;
  const uses = widgetUses();
  if (!uses.length) return out;
  const { checkedConfig, widgetById, widgetData } = await import("./widgets");
  await Promise.all(
    uses.map(async (u) => {
      const w = widgetById(u.widget);
      if (!w?.badge) return;
      try {
        const raw = { ...u.config, __page: u.page };
        const data = await widgetData(u.widget, raw);
        if (data.kind === "error") return;
        const parts = keepParts(await w.badge(checkedConfig(w, raw), data), "widgets", config);
        if (parts?.length) out.set(u.page, [...(out.get(u.page) ?? []), ...parts]);
      } catch {
        // a badge is a bonus
      }
    }),
  );
  return out;
}

/** The rows that need you, by row (with its database and title): a date to remind of, and what the plugins say about their records. */
async function rowParts(config: WsBadgeConfig): Promise<Map<number, { db: number; title: string; parts: BadgePart[] }>> {
  const out = new Map<number, { db: number; title: string; parts: BadgePart[] }>();
  const add = (row: number, db: number, title: string, parts: BadgePart[]) => {
    if (!parts.length) return;
    const cur = out.get(row) ?? { db, title, parts: [] };
    cur.parts.push(...parts);
    out.set(row, cur);
  };
  try {
    const { deadlines } = await import("./deadlines");
    for (const x of config.sources.deadlines ? deadlines() : []) {
      const label = x.days < 0 ? t("{field} overdue", { field: x.field }) : x.days === 0 ? t("{field} today", { field: x.field }) : t("{field} in {n} d", { field: x.field, n: x.days });
      add(x.rowId, x.dbId, x.title, keepParts([{ tone: x.days <= 0 ? "important" : "unread", count: 1, label }], "deadlines", config));
    }
  } catch {
    // no deadlines
  }
  const d = getSqlite();
  // (Each part by what it is — a todo about the row, its unread messages, the rest — switched on or off of its own.)
  const anyRow = config.sources.rowTodos || config.sources.rowMessages || config.sources.rowOther;
  for (const src of anyRow ? rowBadgeSources.list().flatMap((c) => c.impl) : []) {
    try {
      const by = await src.badges();
      if (!by.size) continue;
      const rows = d.prepare("select id, db_id, title, json_extract(props, '$.srcref') ref from ws_pages where db_id is not null and archived_at is null and template = 0 and instr(props, ?) > 0").all(`"srcref":"${src.prefix}`) as { id: number; db_id: number; title: string; ref: string | null }[];
      for (const r of rows) {
        const parts = r.ref ? by.get(r.ref) : undefined;
        if (parts) add(r.id, r.db_id, r.title, parts.flatMap((p) => keepParts([p], rowPartSource(p), config)));
      }
    } catch (e) {
      console.error("[workspace] a row badge source failed", e);
    }
  }
  return out;
}

/** Changed by a source (a sync, a routine) or the AI since the page — a database: since it — was last opened, the last days. */
function activityLines(): Map<number, { n: number; last: string }> {
  const out = new Map<number, { n: number; last: string }>();
  try {
    const d = getSqlite();
    const top = (d.prepare("select coalesce(max(id), 0) n from ws_activity").get() as { n: number }).n;
    const since = new Date(Date.now() - ACTIVITY_DAYS * 864e5).toISOString();
    const rows = d
      .prepare(
        `select coalesce(p.db_id, p.id) id, count(*) n, max(a.at) last from ws_activity a join ws_pages p on p.id = a.page_id
         where a.id > ? and a.at > ? and a.actor != 'you' and p.archived_at is null and p.template = 0 group by 1`,
      )
      .all(top - ACTIVITY_LINES, since) as { id: number; n: number; last: string }[];
    for (const r of rows) out.set(r.id, { n: r.n, last: r.last });
  } catch {
    // no history yet
  }
  return out;
}

async function compute(): Promise<Kept> {
  const at = Date.now();
  // What counts and what is shown (Settings → Badges).
  const config = getWsBadges();
  const own: Record<number, Badge> = {};
  const inner: Record<number, Badge> = {};
  const rows: Record<number, Badge> = {};
  // A mail, chat or inbox database: its unread rows.
  for (const [id, n] of Object.entries(config.sources.unread ? unreadCounts() : {})) {
    const b = badgeOf(keepParts([{ tone: "unread", count: n, label: t("{n} unread", { n }) }], "unread", config));
    if (b) own[Number(id)] = b;
  }
  // A day list: after 18:00, what is still open today (day-lists.ts).
  try {
    const { dayListBadges } = await import("./day-lists");
    for (const [id, x] of config.sources.dayLists ? dayListBadges() : []) {
      const b = sumBadges([own[id], badgeOf(keepParts([{ tone: "unread", count: x.count, label: x.label }], "dayLists", config))]);
      if (b) own[id] = b;
    }
  } catch {
    // a badge is a bonus
  }
  for (const [page, parts] of await widgetParts(config)) {
    const b = sumBadges([own[page], badgeOf(parts)]);
    if (b) own[page] = b;
  }
  // The rows' badges, and their sum on their database (each line said with the row's title).
  const byDb = new Map<number, Badge[]>();
  for (const [row, r] of await rowParts(config)) {
    const b = badgeOf(r.parts);
    if (!b) continue;
    rows[row] = b;
    byDb.set(r.db, [...(byDb.get(r.db) ?? []), { ...b, parts: b.parts.map((p) => `${r.title || t("Untitled")}: ${p}`) }]);
  }
  for (const [db, list] of byDb) {
    const b = sumBadges(list);
    if (b) inner[db] = b;
  }
  // The changes since you last opened a page: only with their source and their dot on.
  return { at, own, inner, rows, activity: config.sources.activity && config.tones.activity.on ? activityLines() : new Map() };
}

/** The settings changed (Settings → Badges): this account's badges are worked out anew at the next reading. */
export function forgetPageBadges(): void {
  kept.delete(currentAccountId());
}

/** Worked out again — one at a time per account (a second asker waits for the same). */
function recompute(account: string): Promise<Kept> {
  const running = busy.get(account);
  if (running) return running;
  const job = withAccount(account, () => compute())
    .then((k) => (kept.set(account, k), k))
    .catch((e) => {
      console.error("[workspace] the tree's badges failed", e);
      const empty: Kept = { ...noBadges(), at: Date.now(), activity: new Map() };
      kept.set(account, empty);
      return empty;
    })
    .finally(() => busy.delete(account));
  busy.set(account, job);
  return job;
}

/** The dots: the activity on pages not opened since (the opening read now, not kept). */
function withActivity(k: Kept): PageBadges {
  const own = { ...k.own };
  if (k.activity.size) {
    const ids = [...k.activity.keys()];
    const opened = new Map<number, string | null>();
    try {
      for (let i = 0; i < ids.length; i += 500) {
        const part = ids.slice(i, i + 500);
        for (const r of getSqlite().prepare(`select id, opened_at from ws_pages where id in (${part.map(() => "?").join(",")})`).all(...part) as { id: number; opened_at: string | null }[]) opened.set(r.id, r.opened_at);
      }
    } catch {
      // no pages
    }
    for (const [id, a] of k.activity) {
      if (!opened.has(id)) continue;
      const seen = opened.get(id);
      if (seen && seen >= a.last) continue;
      const b = sumBadges([own[id], badgeOf([{ tone: "activity", count: a.n, label: a.n === 1 ? t("1 change since you last opened it") : t("{n} changes since you last opened it", { n: a.n }) }])]);
      if (b) own[id] = b;
    }
  }
  return { own, inner: k.inner, rows: k.rows };
}

/**
 * The tree's badges now. `wait`: at most this many ms for a new reading — longer, the last one (marked `stale`, the tree asks again
 * in a moment) or none; without it, as long as it takes.
 */
export async function pageBadges(opts: { wait?: number } = {}): Promise<PageBadges & { stale?: boolean }> {
  hook();
  const account = currentAccountId();
  const cur = kept.get(account);
  if (cur && fresh(cur)) return withActivity(cur);
  const job = recompute(account);
  if (opts.wait === undefined) return withActivity(await job);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const got = await Promise.race([job, new Promise<null>((r) => (timer = setTimeout(() => r(null), opts.wait)))]);
  clearTimeout(timer);
  if (got) return withActivity(got);
  return cur ? { ...withActivity(cur), stale: true } : { ...noBadges(), stale: true };
}
