/**
 * The one search (server): what a typed text finds in every source — the Workspace's pages, the rows of its databases (a group
 * per database), your templates and the built-in ones, people, todos, tickets, mails, messages, documents, Kennzahlen and the
 * commands — as groups, each ranked the same way (lib/search/shared). The menu's pages and settings are found in the browser
 * (the header has them), so `nav` is never asked here. Each source on its own: one failing leaves the others.
 */
import type { PaletteItem } from "@/lib/palette";
import { orderGroups, parseQuery, rank, SOURCE_LABELS, type SearchGroup, type SearchHit, type SearchSource } from "./shared";

export type SearchOptions = { sources?: SearchSource[]; /** Hits per group (more when one source is asked). */ perGroup?: number };

const clip = (s: string | null | undefined, n: number) => {
  const x = (s ?? "").replace(/\s+/g, " ").trim();
  return x.length > n ? `${x.slice(0, n)}…` : x;
};

export async function searchAll(raw: string, opts: SearchOptions = {}): Promise<SearchGroup[]> {
  const { words, commands, within } = parseQuery(raw);
  const asked = new Set<SearchSource>(commands ? ["commands"] : (opts.sources ?? []).filter((s) => s !== "nav"));
  if (!opts.sources && !commands) for (const s of ["pages", "rows", "templates", "people", "todos", "tickets", "mails", "messages", "documents", "metrics", "commands"] as const) asked.add(s);
  // Without words only the commands list (">" alone shows them all).
  if (words.length < 2 && !commands) return [];
  const per = opts.perGroup ?? (asked.size === 1 || within ? 12 : 5);
  const { isInstalled } = await import("@/plugins/state");
  const { t } = await import("@/lib/i18n/server");
  const groups: SearchGroup[] = [];
  const add = (source: SearchSource, items: (PaletteItem & { icon?: string; floor?: number })[], key: string = source, label = SOURCE_LABELS[source], limit = per) => {
    const hits = items.map(({ floor, ...x }): SearchHit => ({ ...x, source, score: rank(x, words, floor) })).sort((a, b) => b.score - a.score);
    if (hits.length) groups.push({ key, source, label, total: hits.length, hits: hits.slice(0, limit) });
  };
  const guarded = async (source: SearchSource, fn: () => Promise<void> | void) => {
    if (!asked.has(source)) return;
    try {
      await fn();
    } catch (e) {
      console.error(`[search] ${source}`, e);
    }
  };

  // The commands: every sync step, "sync all", the Workspace's actions, routines and waiting jobs. Typed among other words,
  // only those the words fit; after ">" all of them, in their kinds (Sync, Agents, Automations, Jobs, Actions).
  await guarded("commands", async () => {
    const items: PaletteItem[] = [];
    const { syncOverview } = await import("@/lib/sync/registry");
    const o = syncOverview();
    items.push({ id: "sync:all", label: `↻ ${t("Sync all")}`, hint: o.all.running ? t("running") : t("Every step, one after the other"), href: "zeff:sync-all", group: "Sync", keywords: "sync all alles synchronisieren abgleichen" });
    for (const s of o.steps) items.push({ id: `sync:${s.key}`, label: `↻ ${s.label}`, hint: s.running ? t("running") : s.what, href: `zeff:sync:${s.key}`, group: "Sync", keywords: `sync synchronisieren abgleichen ${s.key}` });
    if (isInstalled("workspace")) items.push(...(await import("@/plugins/workspace/palette")).workspaceCommandItems());
    const { filterPalette } = await import("@/lib/palette");
    if (!commands) return add("commands", filterPalette(items, words, per).map((x) => ({ ...x, floor: 0 })));
    const found = filterPalette(items, words, 300);
    for (const kind of [...new Set(found.map((x) => x.group))]) add("commands", found.filter((x) => x.group === kind), `commands:${kind}`, kind, 300);
  });
  if (commands) return orderGroups(groups);

  // The Workspace: pages, rows (a group per database), templates — by what they say and are called (ws_fts).
  const ws = isInstalled("workspace");
  if (ws && (asked.has("pages") || asked.has("rows") || asked.has("templates"))) {
    try {
      const store = await import("@/plugins/workspace/store");
      const pages: PaletteItem[] = [];
      const templates: (PaletteItem & { floor?: number })[] = [];
      const rows = new Map<string, PaletteItem[]>();
      for (const h of store.search(words, 120, { templates: asked.has("templates") })) {
        const label = `${h.icon ? `${h.icon} ` : ""}${h.title || t("Untitled")}`.slice(0, 140);
        const item: PaletteItem = { id: `page:${h.id}`, label, hint: (h.snippet ? clip(h.snippet, 140) : h.path) || undefined, href: `/workspace/${h.id}`, group: "", keywords: h.path };
        if (store.inTemplates(h.id)) {
          if (asked.has("templates")) templates.push({ ...item, hint: h.path || t("Your template") });
          continue;
        }
        const name = h.dbId ? store.getDatabase(h.dbId)?.page.title || t("Untitled") : null;
        if (within && !`${name ?? ""} ${h.path}`.toLowerCase().includes(within)) continue;
        if (name === null) {
          if (asked.has("pages")) pages.push({ ...item, group: SOURCE_LABELS.pages });
        } else if (asked.has("rows")) {
          rows.set(`${h.dbId}`, [...(rows.get(`${h.dbId}`) ?? []), { ...item, group: name }]);
        }
      }
      add("pages", pages);
      // A database's rows: a group named after it; the databases with the most hits first (on a tie of their best).
      for (const [dbId, list] of [...rows.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, within ? 3 : 6)) add("rows", list, `rows:${dbId}`, list[0].group);
      // The built-in templates by their name and description (opened as a preview).
      if (asked.has("templates")) {
        const { templateMetas } = await import("@/plugins/workspace/templates");
        const { scoreItem } = await import("@/lib/palette");
        for (const m of templateMetas()) {
          if (m.category === "mine") continue;
          const item = { id: `template:${m.key}`, label: `${m.icon ? `${m.icon} ` : ""}${m.name}`, hint: m.description || t("Built-in template"), href: `/workspace/templates/${encodeURIComponent(m.key)}`, group: SOURCE_LABELS.templates };
          if (scoreItem(item, words)) templates.push({ ...item, floor: 0 });
        }
        add("templates", templates);
      }
    } catch (e) {
      console.error("[search] workspace", e);
    }
  }

  // Kennzahlen: by their name and what they count (shown with their value now).
  await guarded("metrics", async () => {
    if (!ws) return;
    const { formatMetric, listMetrics } = await import("@/plugins/workspace/metrics");
    const items = listMetrics().map((m) => ({ id: `metric:${m.key}`, label: `📊 ${m.label}`, hint: `${m.error ? "⚠" : formatMetric(m.value, m.unit)}${m.what ? ` · ${m.what}` : ""}`, href: `/workspace/metrics#${m.key}`, group: SOURCE_LABELS.metrics, floor: 0 }));
    add("metrics", items.filter((x) => rank(x, words, 0) > 0));
  });

  // People, by what Zeff learned about them (their claims and details: "IBAN Wagner", "Musterstraße").
  await guarded("people", async () => {
    if (isInstalled("people")) add("people", await (await import("@/plugins/people/search")).peoplePaletteItems(words, 12));
  });

  // Todos (T-<id>, their words, their notes) — the open ones first.
  await guarded("todos", async () => {
    if (!isInstalled("todos")) return;
    const { searchTodos } = await import("@/lib/boards/store");
    const found = searchTodos(words, 20).sort((a, b) => Number(a.status === "done") - Number(b.status === "done"));
    add("todos", found.map((x) => ({ id: `todo:${x.id}`, label: `${x.ref} ${x.text}`.slice(0, 140), hint: [x.status === "done" ? t("done") : "", x.ticket].filter(Boolean).join(" · ") || undefined, href: `/t/${x.id}`, group: SOURCE_LABELS.todos, floor: x.status === "done" ? 3 : 5 })));
  });

  // Tickets: by key or summary (the synced ones).
  await guarded("tickets", async () => {
    if (!isInstalled("jira")) return;
    const { getSqlite } = await import("@/db");
    const w = words.toLowerCase();
    const terms = w.split(" ").filter(Boolean).slice(0, 4);
    const where = terms.map(() => "(lower(key) like ? or lower(summary) like ?)").join(" and ");
    const found = getSqlite().prepare(`select key, summary, status from jira_tickets where ${where} order by updated_at desc limit 30`).all(...terms.flatMap((x) => [`${x}%`, `%${x}%`])) as { key: string; summary: string; status: string | null }[];
    add("tickets", found.map((r) => ({ id: `ticket:${r.key}`, label: `🎫 ${r.key} ${clip(r.summary, 110)}`, hint: r.status || undefined, href: `/todos?part=tickets&ticket=${encodeURIComponent(r.key)}`, group: SOURCE_LABELS.tickets })));
  });

  // Mails, messages (Teams) and documents: what Zeff keeps of them, found as the retrieval finds them.
  const terms = [...new Set(words.toLowerCase().split(/[^\p{L}\p{N}_#-]+/u).filter((w) => w.length >= 3))].slice(0, 6);
  const fromRag = async (source: SearchSource, rag: "mails" | "teams" | "documents", href: (ref: string) => string, plugin?: string) =>
    guarded(source, async () => {
      if (!terms.length || (plugin && !isInstalled(plugin))) return;
      const { SEARCHERS } = await import("@/lib/rag");
      const need = Math.min(terms.length, 2);
      const found = (await SEARCHERS[rag](terms, words)).filter((c) => c.score >= need).sort((a, b) => b.score - a.score).slice(0, 30);
      add(source, found.map((c) => ({ id: c.ref, label: clip(c.title, 140), hint: [c.when, clip(c.text, 100)].filter(Boolean).join(" · ") || undefined, href: href(c.ref), group: SOURCE_LABELS[source], floor: 2 + c.score })));
    });
  const q = encodeURIComponent(words);
  await fromRag("mails", "mails", () => `/mail?q=${q}`);
  await fromRag("messages", "teams", () => `/mail?channel=teams&q=${q}`, "teams");
  await fromRag("documents", "documents", (ref) => `/documents?doc=${encodeURIComponent(ref.replace(/^doc:/, ""))}`, "documents");

  return orderGroups(groups);
}
