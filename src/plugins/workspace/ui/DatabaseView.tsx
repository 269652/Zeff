"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { confirmAction } from "@/components/confirm";
import { toast } from "@/components/Toaster";
import { useT } from "@/components/I18nProvider";
import { addRowAction, archivePageAction, databasesAction, duplicateRowAction, exportDatabaseCsvAction, loadDatabaseAction, addSubtaskAction, createDerivedDatabaseAction, placeRowAction, refreshPipelineAction, reviewDatabaseAction, runPipelineAction, setCellAction, setCollectionAction, updateSchemaAction, type DatabaseData } from "../actions";
import { cellText, columnOrder, dateRange, detailModules, dropValue, filterByPeople, mineKeys, moveOption, moveOptionTo, panelProperties, personChips, personPropOf, removeOption, renameOption, setOptionDone, setWipLimit, type Group, filterRows, groupRows, isComputed, newId, hasDependents, moveBefore, newView, removeProperty, sortRows, TITLE, VIEW_TYPES, type DbSchema, type Labels, type Property, type Row, type View, type ViewType } from "../model";
import { Cell, PopCell, type CellCtx } from "./cells";
import { RowCard } from "./cards";
import { RowPeek } from "./RowPeek";
import { GalleryView } from "./gallery";
import { DetailEditor } from "./detail-modules";
import { FilterEditor, PropertiesMenu, SchemaModal, SortEditor } from "./db-menus";
import { Dropdown, MenuItem, useSortable } from "./kit";
import { PipelineEditor, PipelineSummaries } from "./pipeline";
import { AppViewHost } from "./app-view";

/** A database on a page: its views (table, board, list, gallery, calendar), filters, sorts, groups, and the rows in place. */

const VIEW_ICON: Record<ViewType, string> = { table: "▦", board: "▥", list: "☰", gallery: "▤", calendar: "📅", app: "◫" };
/** The view types one picks (an app's view comes with its app). */
const PLAIN_VIEWS = VIEW_TYPES.filter((v) => v !== "app");

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const countRules = (f: View["filter"]): number => f.rules.reduce((n, r) => n + ("rules" in r ? countRules(r) : 1), 0);

/** The views' state and the changes to the database: shared by the page and the blocks. */
function useDatabase(initial: DatabaseData | null, dbId: number) {
  const t = useT();
  const [data, setData] = useState<DatabaseData | null>(initial);
  const [error, setError] = useState("");
  const dataRef = useRef(data);
  useEffect(() => {
    dataRef.current = data;
  });
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const schemaSaving = useRef<Promise<unknown>>(Promise.resolve());
  const schemaTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reload = useCallback(async () => {
    const r = await loadDatabaseAction(dbId);
    if (r.ok) {
      setData(r.data);
      setError("");
    } else setError(r.error);
  }, [dbId]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the rows are fetched when the block appears
    if (!initial) void reload();
  }, [initial, reload]);

  // The assistant (the chat in the sidebar) changed the workspace: the rows and the schema are read again.
  useEffect(() => {
    const again = () => void reload();
    window.addEventListener("ws-changed", again);
    return () => window.removeEventListener("ws-changed", again);
  }, [reload]);

  // Changes from elsewhere (another tab, an agent through the MCP, the Lage, a todo ticked on the Todos tab): the data is
  // read again — this database only, not the page (an editor being typed in stays as it is). A burst is one read, at most
  // every 1.5 s; in a hidden tab it waits until the tab is shown.
  useEffect(() => {
    const topics = new Set(["workspace", "todos", "attention", "kanban"]);
    const source = new EventSource("/api/events");
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stale = false;
    const read = () => {
      timer = null;
      if (document.visibilityState === "hidden") return void (stale = true);
      stale = false;
      void reload();
    };
    const onChange = (e: Event) => {
      if (topics.has((e as MessageEvent<string>).data) && !timer) timer = setTimeout(read, 1500);
    };
    const shown = () => document.visibilityState === "visible" && stale && read();
    source.addEventListener("change", onChange);
    document.addEventListener("visibilitychange", shown);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", shown);
      source.close();
    };
  }, [reload]);

  const reloadSoon = useCallback(() => {
    if (reloadTimer.current) clearTimeout(reloadTimer.current);
    reloadTimer.current = setTimeout(() => void reload(), 600);
  }, [reload]);

  /** Persist the schema now (waits for one in flight). Returns the error, or null. */
  const saveSchema = useCallback(
    async (schema: DbSchema): Promise<string | null> => {
      const run = schemaSaving.current.then(() => updateSchemaAction(dbId, schema));
      schemaSaving.current = run;
      const r = await run;
      if (!r.ok) return r.error;
      await reload();
      return null;
    },
    [dbId, reload],
  );

  /** A view's change: shown at once, saved a moment later. */
  const changeSchema = useCallback(
    (fn: (s: DbSchema) => DbSchema) => {
      const cur = dataRef.current;
      if (!cur) return;
      const next = fn(cur.schema);
      setData({ ...cur, schema: next });
      dataRef.current = { ...cur, schema: next };
      if (schemaTimer.current) clearTimeout(schemaTimer.current);
      schemaTimer.current = setTimeout(() => {
        schemaSaving.current = schemaSaving.current.then(() => updateSchemaAction(dbId, dataRef.current!.schema));
      }, 350);
    },
    [dbId],
  );

  const set = useCallback(
    (rowId: number, propId: string, value: unknown) => {
      const cur = dataRef.current;
      if (!cur) return;
      // Shown at once …
      const rows = cur.rows.map((r) => (r.id === rowId ? (propId === TITLE ? { ...r, title: String(value ?? "") } : { ...r, cells: { ...r.cells, [propId]: value === null || value === "" ? undefined : value } }) : r));
      setData({ ...cur, rows });
      // … saved after any schema change in flight (a new option must be there first), computed cells caught up after.
      schemaSaving.current = schemaSaving.current.then(() => setCellAction(rowId, propId, value)).then((r) => {
        if (!r.ok) {
          toast((r as { error: string }).error, { tone: "error" });
          void reload();
        } else if (cur.schema.properties.some(isComputed)) reloadSoon();
        return r;
      });
    },
    [reload, reloadSoon],
  );

  const addOption = useCallback(
    (propId: string, name: string): string => {
      const id = newId("o");
      changeSchema((s) => ({
        ...s,
        properties: s.properties.map((p) => (p.id === propId ? { ...p, options: [...(p.options ?? []), { id, name, color: ["gray", "blue", "green", "orange", "purple", "pink", "red", "yellow", "brown"][(p.options?.length ?? 0) % 9], group: p.type === "status" ? ("todo" as const) : undefined }] } : p)),
      }));
      return id;
    },
    [changeSchema],
  );

  const addRow = useCallback(
    async (cells: Record<string, unknown> = {}, title = "", templateId?: number): Promise<number | null> => {
      await schemaSaving.current;
      const r = await addRowAction(dbId, { title, cells, templateId });
      if (!r.ok) {
        toast(r.error, { tone: "error" });
        return null;
      }
      await reload();
      return r.id;
    },
    [dbId, reload],
  );

  const removeRow = useCallback(
    async (rowId: number) => {
      const r = await archivePageAction(rowId);
      if (!r.ok) toast(r.error, { tone: "error" });
      await reload();
    },
    [reload],
  );

  const duplicateRow = useCallback(
    async (rowId: number) => {
      const r = await duplicateRowAction(rowId);
      if (!r.ok) toast(r.error, { tone: "error" });
      await reload();
    },
    [reload],
  );

  /** A row placed between two others (the board's manual order): shown at once, then saved. */
  const place = useCallback(
    (rowId: number, after: number | null, before: number | null) => {
      const cur = dataRef.current;
      if (!cur) return;
      const row = cur.rows.find((r) => r.id === rowId);
      if (!row) return;
      const rest = cur.rows.filter((r) => r.id !== rowId);
      const at = before !== null ? rest.findIndex((r) => r.id === before) : after !== null ? rest.findIndex((r) => r.id === after) + 1 : 0;
      rest.splice(at < 0 ? rest.length : at, 0, row);
      setData({ ...cur, rows: rest });
      schemaSaving.current = schemaSaving.current.then(() => placeRowAction(rowId, after, before)).then((r) => {
        if (!r.ok) {
          toast((r as { error: string }).error, { tone: "error" });
          void reload();
        }
        return r;
      });
    },
    [reload],
  );

  void t;
  return { data, error, reload, saveSchema, changeSchema, set, addOption, addRow, removeRow, duplicateRow, place };
}

// ---------------------------------------------------------------------------
// The view area
// ---------------------------------------------------------------------------

type Api = ReturnType<typeof useDatabase>;

const noSubscribe = () => () => {};

export function DatabaseView({ initial, dbId, viewId, onView, embedded = false }: { initial: DatabaseData | null; dbId: number; viewId?: string; onView?: (id: string) => void; embedded?: boolean }) {
  const t = useT();
  const router = useRouter();
  const api = useDatabase(initial, dbId);
  const { data } = api;
  const [current, setCurrent] = useState(viewId ?? "");
  const [q, setQ] = useState("");
  const [schemaOpen, setSchemaOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const search = useSearchParams();
  // ?steps=1 (a derived database just made): its Sources & steps open, to say what it keeps.
  const [pipelineOpen, setPipelineOpen] = useState(() => search.get("steps") === "1");
  const [justAdded, setJustAdded] = useState<number | null>(null);
  // A row opens over the database (?row=<id> — a link to it opens it again); the full page is a click further.
  const [peek, setPeek] = useState<number | null>(() => Number(search.get("row")) || null);
  // The panel is drawn in the browser only (a portal): the server's HTML has none, so nothing to mismatch.
  const inBrowser = useSyncExternalStore(noSubscribe, () => true, () => false);
  const [databases, setDatabases] = useState<{ id: number; title: string }[]>([]);
  useEffect(() => {
    if (schemaOpen || pipelineOpen) void databasesAction().then((r) => r.ok && setDatabases(r.databases.map((d) => ({ id: d.id, title: d.title }))));
  }, [schemaOpen, pipelineOpen]);

  const view = useMemo(() => data?.schema.views.find((v) => v.id === current) ?? data?.schema.views[0], [data, current]);

  const labels: Labels = useMemo(
    () => ({ person: (id) => data?.labels.people[id] ?? `#${id}`, page: (id) => data?.labels.pages[id]?.title ?? `#${id}`, todo: (id) => data?.labels.todos[id] ?? `T-${id}` }),
    [data],
  );

  // Whose rows are shown: the people picked (chips), or only yours.
  const [people, setPeople] = useState<Set<string>>(new Set());
  const [mine, setMine] = useState(false);
  const personProp = data ? personPropOf(data.schema) : undefined;
  const rows = useMemo(() => {
    if (!data || !view) return [];
    const props = data.schema.properties;
    let r = filterRows(data.rows, view.filter, props, labels);
    // A view kept as "only mine" shows only your rows, whatever is picked.
    const onlyMine = mine || !!view.mine;
    if (personProp && (onlyMine || people.size)) r = filterByPeople(r, personProp, onlyMine ? mineKeys(personProp, data.extras?.me ?? { names: [], ids: [] }) : people);
    const w = q.trim().toLowerCase();
    if (w) r = r.filter((x) => x.title.toLowerCase().includes(w) || props.some((p) => cellText(p, x.cells[p.id], labels).toLowerCase().includes(w)));
    return sortRows(r, view.sorts, props);
  }, [data, view, q, labels, personProp, mine, people]);

  if (api.error && !data) return <p className="alert-error text-sm">{api.error}</p>;
  if (!data || !view) return <p className="py-6 text-sm text-zinc-500">{t("Loading …")}</p>;

  const schema = data.schema;
  // A locked database (one a sync keeps, as Jira's) is shown, not changed: its cells, cards and columns stay as they are.
  const ctx: CellCtx = { data, set: api.set, addOption: api.addOption, editable: !data.locked, openRow: (id) => openRow(id) };
  void embedded;
  const switchCollection = async (patch: { briefing?: boolean; knowledge?: boolean }) => {
    const r = await setCollectionAction(dbId, patch);
    if (!r.ok) toast(r.error, { tone: "error" });
    await api.reload();
  };
  const withRow = (id: number | null) => {
    const u = new URL(window.location.href);
    if (id) u.searchParams.set("row", String(id));
    else u.searchParams.delete("row");
    window.history.replaceState(null, "", u);
  };
  const openRow = (id: number) => {
    setPeek(id);
    withRow(id);
  };
  const closePeek = () => {
    setPeek(null);
    withRow(null);
    void api.reload();
  };
  const setView = (v: View) => api.changeSchema((s) => ({ ...s, views: s.views.map((x) => (x.id === v.id ? v : x)) }));
  const pick = (id: string) => {
    setCurrent(id);
    onView?.(id);
  };
  const visible = (view.order ? [...schema.properties].sort((a, b) => (view.order!.indexOf(a.id) + 1 || 999) - (view.order!.indexOf(b.id) + 1 || 999)) : schema.properties).filter((p) => !view.hidden.includes(p.id));
  const filters = countRules(view.filter);

  const addView = (type: ViewType, app?: { id: string; label: string }) => {
    const names: Record<ViewType, string> = { table: t("Table"), board: t("Board"), list: t("List"), gallery: t("Gallery"), calendar: t("Calendar"), app: app?.label ?? t("App") };
    const v = newView(names[type], type);
    if (app) v.app = app.id;
    if (type === "board") v.groupBy = schema.properties.find((p) => p.type === "status" || p.type === "select")?.id;
    if (type === "calendar") v.dateProp = schema.properties.find((p) => p.type === "date")?.id;
    api.changeSchema((s) => ({ ...s, views: [...s.views, v] }));
    pick(v.id);
  };

  /** What a run did: the rows at once; the AI in the background (the view reads what it writes). */
  const ranText = (r: { records: number; created: number; updated: number; archived: number; background: boolean; already: boolean }, syncing: string[]) =>
    r.already
      ? t("The pipeline is running already — the rows follow as it writes them.")
      : [
          t("{n} rows: {c} new, {u} changed, {a} gone", { n: r.records, c: r.created, u: r.updated, a: r.archived }),
          ...(r.background ? [t("the AI runs in the background")] : []),
          ...(syncing.length ? [t("{names} syncing — what it brings follows", { names: syncing.join(", ") })] : []),
        ].join(" · ");

  const newRow = async (cells: Record<string, unknown> = {}, templateId?: number, open = false) => {
    const id = await api.addRow(cells, "", templateId);
    if (!id) return;
    // A row from a template opens as a page; a plain one is named in place.
    if (open) openRow(id);
    else setJustAdded(id);
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1">
        <div className="flex min-w-0 flex-wrap items-center gap-0.5" role="tablist" aria-label={t("Views")}>
          {schema.views.map((v) => (
            <button key={v.id} type="button" role="tab" aria-selected={v.id === view.id} onClick={() => pick(v.id)} className={`rounded-md px-2 py-1 text-sm ${v.id === view.id ? "bg-zinc-100 font-medium dark:bg-zinc-800" : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}>
              {v.type === "app" ? (data.extras?.appViews?.find((a) => a.id === v.app)?.icon ?? VIEW_ICON.app) : VIEW_ICON[v.type]} {v.name}
            </button>
          ))}
          <Dropdown label="+" title={t("Add a view")} className="rounded-md px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">
            {(close) =>
              [...PLAIN_VIEWS.map((vt) => (
                <MenuItem
                  key={vt}
                  onClick={() => {
                    addView(vt);
                    close();
                  }}
                >
                  {VIEW_ICON[vt]} {{ table: t("Table"), board: t("Board"), list: t("List"), gallery: t("Gallery"), calendar: t("Calendar"), app: "" }[vt]}
                </MenuItem>
              )),
              // The apps' views this database can have (its type: mails, messages — their plugins installed).
              ...(data.extras?.appViews ?? []).map((a) => (
                <MenuItem
                  key={`app-${a.id}`}
                  onClick={() => {
                    addView("app", a);
                    close();
                  }}
                >
                  {a.icon} {a.label}
                </MenuItem>
              ))]
            }
          </Dropdown>
        </div>
        <span className="flex-1" />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search …")} aria-label={t("Search the rows")} className="input w-36 text-sm" />
        <Dropdown label={`${t("Filter")}${filters ? ` · ${filters}` : ""}`} className={`btn btn-sm ${filters ? "text-indigo-600 dark:text-indigo-400" : ""}`}>
          {() => (
            <div className="w-[34rem] max-w-[90vw] space-y-2 p-2">
              <FilterEditor filter={view.filter} schema={schema} data={data} onChange={(filter) => setView({ ...view, filter })} />
              {filters > 0 && (
                <button type="button" className="text-sm text-zinc-500 hover:underline" onClick={() => setView({ ...view, filter: { op: "and", rules: [] } })}>
                  {t("Clear the filter")}
                </button>
              )}
            </div>
          )}
        </Dropdown>
        <Dropdown label={`${t("Sort")}${view.sorts.length ? ` · ${view.sorts.length}` : ""}`} className={`btn btn-sm ${view.sorts.length ? "text-indigo-600 dark:text-indigo-400" : ""}`}>
          {() => (
            <div className="w-80 p-2">
              <SortEditor sorts={view.sorts} schema={schema} onChange={(sorts) => setView({ ...view, sorts })} />
            </div>
          )}
        </Dropdown>
        {(view.type === "board" || view.type === "table" || view.type === "list") && (
          <select className="input w-auto text-sm" value={view.groupBy ?? ""} aria-label={t("Group by")} onChange={(e) => setView({ ...view, groupBy: e.target.value || undefined })}>
            <option value="">{view.type === "board" ? t("Group by …") : t("No grouping")}</option>
            {schema.properties.filter((p) => ["select", "status", "multi_select", "person", "checkbox", "relation"].includes(p.type)).map((p) => (
              <option key={p.id} value={p.id}>
                {t("Group by {name}", { name: p.name })}
              </option>
            ))}
          </select>
        )}
        {view.type === "calendar" && (
          <select className="input w-auto text-sm" value={view.dateProp ?? ""} aria-label={t("Date property")} onChange={(e) => setView({ ...view, dateProp: e.target.value || undefined })}>
            <option value="">{t("Date by …")}</option>
            {schema.properties.filter((p) => p.type === "date").map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
        {schema.pipeline?.steps.some((s) => s.kind === "source") && !data.extras?.source && (
          <button
            type="button"
            className="btn btn-sm"
            title={t("Refresh from the sources")}
            aria-label={t("Refresh from the sources")}
            disabled={!!data.extras?.running}
            onClick={async () => {
              const r = await refreshPipelineAction(dbId);
              await api.reload();
              if (!r.ok) return void toast(r.error, { tone: "error" });
              toast(ranText(r, r.syncing), { tone: "ok" });
            }}
          >
            {data.extras?.running ? <span className="inline-block animate-spin">↻</span> : "↻"}
          </button>
        )}
        <Dropdown label={t("Properties")} align="right" className="btn btn-sm">
          {() => <PropertiesMenu view={view} schema={schema} onChange={setView} />}
        </Dropdown>
        <Dropdown label="⋯" align="right" title={t("More")} className="btn btn-sm">
          {(close) => (
            <>
              <MenuItem onClick={() => (close(), setSchemaOpen(true))}>⚙ {t("Edit properties …")}</MenuItem>
              <MenuItem onClick={() => (close(), setDetailOpen(true))}>▤ {t("Detail view …")}</MenuItem>
              <MenuItem onClick={() => (close(), setPipelineOpen(true))}>⛓ {t("Sources & steps …")}</MenuItem>
              <MenuItem
                onClick={async () => {
                  close();
                  const r = await createDerivedDatabaseAction(dbId);
                  if (!r.ok) return void toast(r.error, { tone: "error" });
                  router.push(`/workspace/${r.id}?steps=1`);
                  router.refresh();
                }}
              >
                ＋ {t("Derived database …")}
              </MenuItem>
              {personProp && (
                <MenuItem checked={!!view.mine} onClick={() => (close(), setView({ ...view, mine: !view.mine }))}>
                  {t("Only mine in this view")}
                </MenuItem>
              )}
              {schema.properties.some((p) => p.type === "ai") && (
                <>
                  <MenuItem checked={!!schema.review?.on} onClick={() => (close(), api.changeSchema((s) => ({ ...s, review: { on: !s.review?.on } })))}>
                    {t("AI review (with the briefing)")}
                  </MenuItem>
                  <MenuItem
                    onClick={() => {
                      close();
                      toast(t("The AI reads the rows that changed …"));
                      void reviewDatabaseAction(dbId).then((r) => (r.ok ? toast(t("{n} rows filled, {m} unchanged", { n: r.reviewed, m: r.unchanged }), { tone: "ok" }) : toast(r.error, { tone: "error" })));
                    }}
                  >
                    ✨ {t("Review now")}
                  </MenuItem>
                </>
              )}
              {/* What goes out of it (into the Ticket-Lage; the knowledge server picks for itself): the Workspace's settings. */}
              <MenuItem onClick={() => (close(), router.push(`/workspace/settings/outputs#db-${dbId}`))}>📤 {t("Outputs …")}</MenuItem>
              <div className="px-2 py-1">
                <input className="input w-full text-sm" value={view.name} aria-label={t("View name")} onChange={(e) => setView({ ...view, name: e.target.value })} />
              </div>
              <p className="px-2 pt-1 text-xs text-zinc-500">{t("Show this view as — to keep it as it is, add another view with “+”")}</p>
              <div className="flex flex-wrap gap-1 px-2 pb-1">
                {PLAIN_VIEWS.map((vt) => (
                  <button key={vt} type="button" className={`rounded px-1.5 py-0.5 text-sm ${view.type === vt ? "bg-indigo-100 dark:bg-indigo-950" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"}`} title={vt} aria-pressed={view.type === vt} onClick={() => setView({ ...view, type: vt, groupBy: vt === "board" && !view.groupBy ? schema.properties.find((p) => p.type === "status" || p.type === "select")?.id : view.groupBy, dateProp: vt === "calendar" && !view.dateProp ? schema.properties.find((p) => p.type === "date")?.id : view.dateProp })}>
                    {VIEW_ICON[vt]}
                  </button>
                ))}
              </div>
              <MenuItem
                onClick={() => {
                  close();
                  const copy = { ...view, id: newId("v"), name: `${view.name} (${t("copy")})` };
                  api.changeSchema((s) => ({ ...s, views: [...s.views, copy] }));
                  pick(copy.id);
                }}
              >
                ⧉ {t("Duplicate the view")}
              </MenuItem>
              <MenuItem
                disabled={schema.views.length < 2}
                danger
                onClick={() => {
                  close();
                  const rest = schema.views.filter((v) => v.id !== view.id);
                  api.changeSchema((s) => ({ ...s, views: rest }));
                  pick(rest[0].id);
                }}
              >
                🗑 {t("Delete the view")}
              </MenuItem>
              <MenuItem
                onClick={async () => {
                  close();
                  const r = await exportDatabaseCsvAction(dbId, view.id);
                  if (!r.ok) return toast(r.error, { tone: "error" });
                  const url = URL.createObjectURL(new Blob([`﻿${r.csv}`], { type: "text/csv;charset=utf-8" }));
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = r.filename;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                ⇩ {t("Export as CSV")}
              </MenuItem>
            </>
          )}
        </Dropdown>
        <div className={`flex ${data.locked ? "hidden" : ""}`}>
          <button type="button" className="btn btn-primary btn-sm rounded-r-none" onClick={() => void newRow({}, undefined, false)}>
            {t("New")}
          </button>
          <Dropdown label="▾" align="right" title={t("New from a template")} className="btn btn-primary btn-sm rounded-l-none border-l border-indigo-400 px-1.5">
            {(close) => (
              <>
                {data.templates.map((tp) => (
                  <MenuItem key={tp.id} onClick={() => (close(), void newRow({}, tp.id, true))}>
                    📋 {tp.title}
                  </MenuItem>
                ))}
                {!data.templates.length && <p className="max-w-56 px-2 py-1.5 text-xs text-zinc-500">{t("No templates yet — open a row and choose “Use as a template” in its menu.")}</p>}
              </>
            )}
          </Dropdown>
        </div>
      </div>

      {personProp && (
        <PeopleBar
          chips={personChips(data.rows, personProp, (k) => labels.person(Number(k)))}
          picked={people}
          onPick={(k) => {
            setMine(false);
            setPeople((cur) => {
              const next = new Set(cur);
              if (next.has(k)) next.delete(k);
              else next.add(k);
              return next;
            });
          }}
          onAll={() => (setMine(false), setPeople(new Set()))}
          mine={mine}
          onMine={(data.extras?.me.names.length || data.extras?.me.ids.length) ? () => (setPeople(new Set()), setMine(!mine)) : undefined}
        />
      )}

      {data.extras?.running && <p className="text-sm text-indigo-600 dark:text-indigo-400" data-running>✨ {t("The AI is going through the rows — they change as it writes them …")}</p>}
      <PipelineSummaries pipeline={schema.pipeline} />
      {view.type === "app" && <AppViewHost view={view} data={data} rows={rows} openRow={openRow} reload={() => void api.reload()} fallback={<TableView view={view} rows={rows} visible={visible} schema={schema} ctx={ctx} api={api} labels={labels} openRow={openRow} setView={setView} onSchema={() => setSchemaOpen(true)} justAdded={justAdded} onEdited={() => setJustAdded(null)} />} />}
      {view.type === "table" && <TableView view={view} rows={rows} visible={visible} schema={schema} ctx={ctx} api={api} labels={labels} openRow={openRow} setView={setView} onSchema={() => setSchemaOpen(true)} justAdded={justAdded} onEdited={() => setJustAdded(null)} />}
      {view.type === "board" && <BoardView view={view} rows={rows} visible={visible} schema={schema} ctx={ctx} api={api} labels={labels} openRow={openRow} newRow={newRow} />}
      {view.type === "list" && <ListView view={view} rows={rows} visible={visible} schema={schema} ctx={ctx} api={api} labels={labels} openRow={openRow} />}
      {view.type === "gallery" && <GalleryView rows={rows} visible={visible} ctx={ctx} openRow={openRow} add={(cells, title) => api.addRow(cells, title)} locked={!!data.locked} />}
      {view.type === "calendar" && <CalendarView view={view} rows={rows} schema={schema} api={api} openRow={openRow} newRow={newRow} />}
      <p className="text-xs text-zinc-500">{rows.length === data.rows.length ? (rows.length === 1 ? t("1 row") : t("{n} rows", { n: rows.length })) : t("{n} of {total} rows", { n: rows.length, total: data.rows.length })}</p>

      {schemaOpen && <SchemaModal schema={schema} data={data} dbId={dbId} databases={databases} onSave={api.saveSchema} onClose={() => setSchemaOpen(false)} />}
      {detailOpen && (
        <DetailEditor
          modules={detailModules(schema, data.extras?.source)}
          custom={!!schema.detail}
          onChange={(next) => api.changeSchema((s) => (next ? { ...s, detail: next } : (({ detail: _, ...rest }) => rest)(s)))}
          onClose={() => setDetailOpen(false)}
        />
      )}
      {pipelineOpen && (
        <PipelineEditor
          dbId={dbId}
          pipeline={schema.pipeline}
          synced={data.extras?.source ?? null}
          fields={schema.properties.filter((p) => !["srcref", "srcedited", "srcurl", "ticketkey", "noteref"].includes(p.id)).map((p) => p.name)}
          databases={databases}
          onSave={async (pipeline) => {
            const err = await api.saveSchema({ ...(api.data?.schema ?? schema), pipeline });
            if (err) toast(err, { tone: "error" });
          }}
          onRun={async (ai) => {
            const r = await runPipelineAction(dbId, ai);
            await api.reload();
            if (!r.ok) return void toast(r.error, { tone: "error" });
            toast(ranText(r, []), { tone: "ok" });
          }}
          onClose={() => setPipelineOpen(false)}
        />
      )}
      {inBrowser && peek !== null && data.rows.some((r) => r.id === peek) && <RowPeek key={peek} data={data} rowId={peek} onClose={closePeek} />}
    </div>
  );
}

type ViewProps = { view: View; rows: Row[]; visible: Property[]; schema: DbSchema; ctx: CellCtx; api: Api; labels: Labels; openRow: (id: number) => void };

function RowMenu({ row, api }: { row: Row; api: Api }) {
  const t = useT();
  if (api.data?.locked) return null; // a sync keeps its rows
  return (
    <Dropdown label="⋮" title={t("Row actions")} className="icon-btn" align="left">
      {(close) => (
        <>
          <MenuItem onClick={() => (close(), void api.duplicateRow(row.id))}>⧉ {t("Duplicate")}</MenuItem>
          <MenuItem danger onClick={() => (close(), void api.removeRow(row.id))}>
            🗑 {t("Delete")}
          </MenuItem>
        </>
      )}
    </Dropdown>
  );
}

function TitleCell({ row, ctx, openRow, autoEdit = false, onEdited }: { row: Row; ctx: CellCtx; openRow: (id: number) => void; autoEdit?: boolean; onEdited?: () => void }) {
  const t = useT();
  const [editing, setEditing] = useState(autoEdit);
  const [text, setText] = useState(row.title);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- the field follows the row when it is changed elsewhere
  useEffect(() => setText(row.title), [row.title]);
  if (editing)
    return (
      <input
        autoFocus
        className="ws-cell-input"
        value={text}
        aria-label={t("Title")}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          setEditing(false);
          onEdited?.();
          if (text !== row.title) ctx.set(row.id, TITLE, text);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            setText(row.title);
            setEditing(false);
          }
        }}
      />
    );
  return (
    <div className="group/title flex min-h-8 items-center gap-1 px-2 py-1">
      <span>{row.icon || "📄"}</span>
      <button type="button" className="min-w-0 flex-1 truncate text-left font-medium hover:underline" onClick={() => openRow(row.id)} title={t("Open")}>
        {row.title || <span className="text-zinc-400">{t("Untitled")}</span>}
      </button>
      <button type="button" className="icon-btn opacity-0 group-hover/title:opacity-100" onClick={() => setEditing(true)} aria-label={t("Rename")} title={t("Rename")}>
        ✎
      </button>
    </div>
  );
}

function TableView({ view, rows, visible, schema, ctx, api, labels, openRow, setView, onSchema, justAdded, onEdited }: ViewProps & { setView: (v: View) => void; onSchema: () => void; justAdded: number | null; onEdited: () => void }) {
  const t = useT();
  const groups = view.groupBy ? groupRows(rows, view.groupBy, schema.properties, labels) : [{ key: "", label: "", color: undefined as string | undefined, rows }];
  const [folded, setFolded] = useState<Set<string>>(new Set());
  // The columns in the view's order - the title is one of them and may sit anywhere (drag a header to move it).
  const cols = columnOrder(view, schema).filter((id) => id === TITLE || visible.some((p) => p.id === id));
  const byId = new Map(visible.map((p) => [p.id, p]));
  const sort = useSortable((from, to, after) => setView({ ...view, order: moveBefore(columnOrder(view, schema), from, to, after) }), "x", "text/ws-col");
  const header = (
    <thead>
      <tr>
        <th className="w-8" />
        {cols.map((id) => {
          const p = byId.get(id);
          const drag = { ...sort.handle(id), ...sort.target(id) };
          if (!p)
            return (
              <th key={id} className={`min-w-56 cursor-grab ${sort.mark(id)}`} title={t("Drag to move the column")} {...drag}>
                {schema.titleName}
              </th>
            );
          return (
          <th key={p.id} className={`cursor-grab ${sort.mark(p.id)}`} title={t("Drag to move the column")} {...drag}>
            <Dropdown label={<span>{p.name}</span>} className="flex items-center gap-1 text-left">
              {(close) => (
                <>
                  <MenuItem onClick={() => (close(), setView({ ...view, sorts: [{ prop: p.id, dir: "asc" }] }))}>↑ {t("Sort ascending")}</MenuItem>
                  <MenuItem onClick={() => (close(), setView({ ...view, sorts: [{ prop: p.id, dir: "desc" }] }))}>↓ {t("Sort descending")}</MenuItem>
                  <MenuItem onClick={() => (close(), setView({ ...view, hidden: [...view.hidden, p.id] }))}>🙈 {t("Hide")}</MenuItem>
                  <MenuItem onClick={() => (close(), onSchema())}>⚙ {t("Edit properties …")}</MenuItem>
                  <MenuItem
                    danger
                    onClick={() => {
                      close();
                      const note = hasDependents(schema, p.id) ? ` ${t("Other properties use this one (a rollup or a relation's other side).")}` : "";
                      if (!window.confirm(`${t("Delete the property “{name}” and its values?", { name: p.name })}${note}`)) return;
                      api.changeSchema((s) => removeProperty(s, p.id));
                    }}
                  >
                    🗑 {t("Delete the property")}
                  </MenuItem>
                </>
              )}
            </Dropdown>
          </th>
          );
        })}
        <th className="w-8">
          <button type="button" className="icon-btn" onClick={onSchema} aria-label={t("Add a property")} title={t("Add a property")}>
            +
          </button>
        </th>
      </tr>
    </thead>
  );
  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
      <table className="ws-table">
        {header}
        {groups.map((g) => (
          <tbody key={g.key || "all"}>
            {view.groupBy && (
              <tr>
                <td colSpan={visible.length + 3} className="bg-zinc-50 px-2 py-1 dark:bg-zinc-900/50">
                  <button type="button" className="flex items-center gap-2 text-sm" onClick={() => setFolded((f) => (f.has(g.key) ? new Set([...f].filter((x) => x !== g.key)) : new Set([...f, g.key])))} aria-expanded={!folded.has(g.key)}>
                    <span>{folded.has(g.key) ? "▸" : "▾"}</span>
                    {g.color ? <span className="ws-tag" data-color={g.color}>{g.label}</span> : <span className="font-medium">{g.label || t("No value")}</span>}
                    <span className="text-zinc-400">{g.rows.length}</span>
                  </button>
                </td>
              </tr>
            )}
            {!folded.has(g.key) &&
              g.rows.map((r) => (
                <tr key={r.id} className="group/row">
                  <td className="w-8 text-center align-middle">
                    <span className="opacity-0 group-hover/row:opacity-100">
                      <RowMenu row={r} api={api} />
                    </span>
                  </td>
                  {cols.map((id) => {
                    const p = byId.get(id);
                    return p ? (
                      <td key={p.id}>
                        <Cell p={p} row={r} ctx={ctx} />
                      </td>
                    ) : (
                      <td key={id}>
                        <TitleCell row={r} ctx={ctx} openRow={openRow} autoEdit={justAdded === r.id} onEdited={onEdited} />
                      </td>
                    );
                  })}
                  <td />
                </tr>
              ))}
            {!folded.has(g.key) && (
              <tr>
                <td colSpan={visible.length + 3}>
                  <button
                    type="button"
                    className="w-full px-3 py-1.5 text-left text-sm text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-900"
                    onClick={() => {
                      const gp = view.groupBy ? schema.properties.find((p) => p.id === view.groupBy) : undefined;
                      void api.addRow(gp && g.key ? { [gp.id]: gp.type === "multi_select" || gp.type === "person" || gp.type === "relation" ? [gp.type === "multi_select" ? g.key : Number(g.key)] : gp.type === "checkbox" ? g.key === "true" : g.key } : {});
                    }}
                  >
                    + {t("New")}
                  </button>
                </td>
              </tr>
            )}
          </tbody>
        ))}
      </table>
    </div>
  );
}

function BoardView({ view, rows, visible, schema, ctx, api, labels, openRow, newRow }: ViewProps & { newRow: (cells?: Record<string, unknown>, templateId?: number, open?: boolean) => Promise<void> }) {
  // A subtask (its parent named): no subtasks of its own.
  const parentProp = schema.properties.find((p) => p.type === "relation" && p.relationDb === ctx.data.id && !p.backOf);
  const isSubtask = (r: Row) => !!parentProp && (Array.isArray(r.cells[parentProp.id]) ? (r.cells[parentProp.id] as unknown[]).length > 0 : !!r.cells[parentProp.id]);
  const t = useT();
  const gp = schema.properties.find((p) => p.id === view.groupBy);
  // Where a dragged card would land: its column and the card it would go before (null: the end).
  const [over, setOver] = useState<{ key: string; before: number | null } | null>(null);
  // A column being dragged (its head) — and the column it would go in front of.
  const [colOver, setColOver] = useState<string | null>(null);
  if (!gp) return <p className="rounded-lg border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">{t("Choose a property to group the board by (a status or a select).")}</p>;
  const groups = groupRows(rows, gp.id, schema.properties, labels);
  const valueFor = (key: string): unknown => (gp.type === "checkbox" ? key === "true" : key === "" ? null : gp.type === "multi_select" ? [key] : gp.type === "person" || gp.type === "relation" ? [Number(key)] : key);
  // A manual order only when the view isn't sorted (else the sort decides).
  const ordered = !view.sorts.length;
  /** The card the cursor is above (by its vertical middle) in a column: the one to land before. */
  const beforeAt = (col: HTMLElement, y: number): number | null => {
    for (const el of col.querySelectorAll<HTMLElement>("[data-row]")) {
      const r = el.getBoundingClientRect();
      if (y < r.top + r.height / 2) return Number(el.dataset.row);
    }
    return null;
  };
  return (
    <div className="flex items-start gap-3 overflow-x-auto pb-2">
      {groups.map((g) => (
        <div
          key={g.key || "none"}
          className={`ws-column w-72 shrink-0 space-y-2 rounded-xl p-2 ${over?.key === g.key ? "ws-column-over" : ""} ${colOver === g.key ? "ws-column-drop-before" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            if (e.dataTransfer.types.includes("text/ws-col")) return void (colOver !== g.key && setColOver(g.key));
            const before = beforeAt(e.currentTarget, e.clientY);
            if (over?.key !== g.key || over.before !== before) setOver({ key: g.key, before });
          }}
          onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && (setOver(null), setColOver(null))}
          onDrop={(e) => {
            e.preventDefault();
            setColOver(null);
            const col = e.dataTransfer.getData("text/ws-col");
            if (col) {
              // A column dropped on another: in front of it ("No value" stays last).
              if (!ctx.data.locked && gp.options?.some((o) => o.id === g.key)) api.changeSchema((s) => moveOptionTo(s, gp.id, col, g.key));
              return;
            }
            const before = beforeAt(e.currentTarget, e.clientY);
            setOver(null);
            if (ctx.data.locked) return;
            const id = Number(e.dataTransfer.getData("text/ws-row"));
            const from = e.dataTransfer.getData("text/ws-from");
            const row = rows.find((r) => r.id === id);
            if (!row) return;
            if (from !== g.key) api.set(id, gp.id, dropValue(gp, row.cells[gp.id], from, g.key));
            if (ordered && before !== id) {
              const list = g.rows.filter((r) => r.id !== id);
              const at = before === null ? list.length : list.findIndex((r) => r.id === before);
              api.place(id, list[at - 1]?.id ?? null, list[at]?.id ?? null);
            }
          }}
        >
          <ColumnHead g={g} gp={gp} view={view} rows={rows} api={api} locked={!!ctx.data.locked} />
          {g.rows.map((r) => (
            <div key={r.id} className="group/sub">
            <div
              data-row={r.id}
              data-attention={ctx.data.extras?.tickets[ctx.data.extras.keys[r.id] ?? ""]?.attention ?? undefined}
              className={`ws-card group/card relative cursor-pointer ${over?.key === g.key && over.before === r.id ? "ws-card-drop-before" : ""}`}
              draggable={!ctx.data.locked}
              onDragStart={(e) => {
                e.dataTransfer.setData("text/ws-row", String(r.id));
                e.dataTransfer.setData("text/ws-from", g.key);
                e.dataTransfer.effectAllowed = "move";
              }}
              onClick={() => openRow(r.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && openRow(r.id)}
            >
              <span className="absolute top-1 right-1 rounded bg-white/90 opacity-0 group-hover/card:opacity-100 dark:bg-zinc-900/90" onClick={(e) => e.stopPropagation()}>
                <RowMenu row={r} api={api} />
              </span>
              <RowCard row={r} visible={visible.filter((p) => p.id !== gp.id)} ctx={ctx} mode="board" />
            </div>
            {/* A subtask's shadow card under it on hover (not under a subtask: one level). */}
            {!ctx.data.locked && !isSubtask(r) && <SubtaskGhost parentId={r.id} after={() => void api.reload()} />}
            </div>
          ))}
          {over?.key === g.key && over.before === null && <div className="ws-drop-line" aria-hidden />}
          {!ctx.data.locked && <NewCard cells={{ [gp.id]: valueFor(g.key) }} add={(cells, title) => api.addRow(cells, title)} />}
        </div>
      ))}
      {!ctx.data.locked && (gp.type === "status" || gp.type === "select" || gp.type === "multi_select") && <AddColumn add={(name) => void api.addOption(gp.id, name)} />}
    </div>
  );
}

/** Whose rows: "Mine", then a chip per person with their count (and nobody), several at once — as Kanban's person chips. */
function PeopleBar({ chips, picked, onPick, onAll, mine, onMine }: { chips: { key: string; label: string; count: number }[]; picked: Set<string>; onPick: (key: string) => void; onAll: () => void; mine: boolean; onMine?: () => void }) {
  const t = useT();
  if (chips.length < 2 && !onMine) return null;
  const chip = (on: boolean) => `rounded-full border px-2.5 py-0.5 text-xs ${on ? "border-indigo-400 bg-indigo-50 text-indigo-700 dark:border-indigo-700 dark:bg-indigo-950 dark:text-indigo-300" : "border-zinc-200 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"}`;
  return (
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label={t("Filter by person")}>
      {onMine && (
        <button type="button" className={chip(mine)} aria-pressed={mine} onClick={onMine}>
          ★ {t("Mine")}
        </button>
      )}
      {chips.map((c) => (
        <button key={c.key || "none"} type="button" className={chip(picked.has(c.key))} aria-pressed={picked.has(c.key)} onClick={() => onPick(c.key)}>
          {c.key ? c.label : `— ${t("Nobody")}`} <span className="text-zinc-400">{c.count}</span>
        </button>
      ))}
      {(picked.size > 0 || mine) && (
        <button type="button" className="px-1 text-xs text-zinc-500 hover:underline" onClick={onAll}>
          {t("all")}
        </button>
      )}
    </div>
  );
}

/**
 * A board column's head, edited in place as Kanban's: its name (click to rename), "n" or "n/WIP" (red over the limit), ✓ when
 * it counts as done — and its menu: move left/right, counts as done, WIP limit, delete (only when empty).
 */
function ColumnHead({ g, gp, view, rows, api, locked }: { g: Group; gp: Property; view: View; rows: Row[]; api: Api; locked: boolean }) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const option = locked ? undefined : gp.options?.find((o) => o.id === g.key);
  const shown = gp.options?.find((o) => o.id === g.key);
  const wip = shown ? view.wip?.[shown.id] : undefined;
  const over = wip !== undefined && g.rows.length > wip;
  const done = shown?.group === "done";
  const label = g.label || t("No value");
  const change = (fn: (s: DbSchema) => DbSchema) => {
    try {
      api.changeSchema(fn);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), { tone: "error" });
    }
  };
  const i = gp.options?.findIndex((o) => o.id === g.key) ?? -1;
  return (
    <div
      className={`flex items-center gap-2 px-1 text-sm ${option ? "cursor-grab" : ""}`}
      draggable={!!option && !editing}
      onDragStart={(e) => {
        if (!option) return;
        e.stopPropagation();
        e.dataTransfer.setData("text/ws-col", option.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      title={option ? t("Drag to move the column") : undefined}
    >
      {option && editing ? (
        <input
          autoFocus
          defaultValue={option.name}
          aria-label={t("Column …")}
          className="input min-w-0 flex-1 py-0.5 text-sm"
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") setEditing(false);
          }}
          onBlur={(e) => {
            const name = e.currentTarget.value;
            setEditing(false);
            if (name.trim() && name.trim() !== option.name) change((s) => renameOption(s, gp.id, option.id, name));
          }}
        />
      ) : option ? (
        <button type="button" onClick={() => setEditing(true)} className="ws-tag cursor-text" data-color={g.color} title={t("Column …")}>
          {label}
        </button>
      ) : shown ? (
        <span className="ws-tag" data-color={g.color}>
          {label}
        </span>
      ) : (
        <span className="font-medium text-zinc-500">{label}</span>
      )}
      {done && <span className="text-emerald-600" aria-hidden>✓</span>}
      <span className={over ? "font-semibold text-red-600" : "text-zinc-400"}>{wip !== undefined ? `${g.rows.length}/${wip}` : g.rows.length}</span>
      {option && (
        <span className="ml-auto">
          <Dropdown label="✎" title={t("Column menu")} align="right" className="rounded px-1 text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700">
            {(close) => (
              <>
                <MenuItem disabled={i <= 0} onClick={() => (change((s) => moveOption(s, gp.id, option.id, -1)), close())}>
                  {t("← move left")}
                </MenuItem>
                <MenuItem disabled={i < 0 || i >= (gp.options?.length ?? 0) - 1} onClick={() => (change((s) => moveOption(s, gp.id, option.id, 1)), close())}>
                  {t("move right →")}
                </MenuItem>
                {gp.type === "status" && (
                  <MenuItem onClick={() => (change((s) => setOptionDone(s, gp.id, option.id, !done)), close())}>{done ? t("No longer counts as done") : t("Counts as done ✓")}</MenuItem>
                )}
                <MenuItem
                  onClick={() => {
                    close();
                    const v = prompt(t("WIP limit (empty: none)"), wip ? String(wip) : "");
                    if (v !== null) change((s) => setWipLimit(s, view.id, option.id, v.trim() ? Number(v) : null));
                  }}
                >
                  {t("WIP limit …")}
                </MenuItem>
                <MenuItem
                  danger
                  onClick={() => {
                    close();
                    // Its cards would lose their place: only an empty column goes (all rows, not just the filtered ones).
                    const n = (api.data?.rows ?? rows).filter((r) => [r.cells[gp.id]].flat().includes(option.id)).length;
                    if (n) return void toast(n === 1 ? t("The column still has 1 card — move it first.") : t("The column still has {n} cards — move them first.", { n }), { tone: "error" });
                    if (confirmAction(t("Delete the column “{name}”?", { name: option.name }))) change((s) => removeOption(s, gp.id, option.id, api.data?.rows ?? rows));
                  }}
                >
                  {t("Delete column")}
                </MenuItem>
              </>
            )}
          </Dropdown>
        </span>
      )}
    </div>
  );
}

/** "+ Column" at the end of a board: a new option of the property it groups by. */
function AddColumn({ add }: { add: (name: string) => void }) {
  const t = useT();
  const [name, setName] = useState("");
  return (
    <div className="w-72 shrink-0 rounded-xl border-2 border-dashed border-zinc-200 p-2 dark:border-zinc-800">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && name.trim()) {
            add(name.trim());
            setName("");
          }
        }}
        placeholder={t("+ Column")}
        aria-label={t("New column")}
        className="w-full bg-transparent px-1 py-1 text-sm outline-none"
      />
    </div>
  );
}

/**
 * "+ New" at the end of a board column, as Kanban's "+ Card": a field for the title — Enter makes the card (in this column)
 * and keeps the field open for the next one, Shift+Enter a new line, Escape or leaving it empty closes it.
 */
/** Under a card on hover: a shadow card — a click, a title, Enter: a subtask of it (in its column, right below it). */
function SubtaskGhost({ parentId, after }: { parentId: number; after: () => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  if (!open)
    return (
      <button
        type="button"
        className="mt-1 hidden w-full rounded-md border border-dashed border-zinc-300 px-2 py-1 text-left text-xs text-zinc-400 group-hover/sub:block hover:border-indigo-300 hover:text-indigo-600 dark:border-zinc-700"
        onClick={() => setOpen(true)}
        data-subtask-ghost={parentId}
      >
        + {t("Subtask")}
      </button>
    );
  const save = async () => {
    const title = text.trim();
    if (!title) return setOpen(false);
    setBusy(true);
    const r = await addSubtaskAction(parentId, title);
    if (r.ok) await placeRowAction(r.id, parentId, null);
    setBusy(false);
    if (!r.ok) return void toast(r.error, { tone: "error" });
    setText("");
    after();
  };
  return (
    <textarea
      autoFocus
      rows={1}
      value={text}
      readOnly={busy}
      className="input mt-1 w-full border-dashed text-sm"
      placeholder={t("Subtask")}
      aria-label={t("New subtask")}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          void save();
        } else if (e.key === "Escape") {
          setText("");
          setOpen(false);
        }
      }}
      onBlur={() => !text.trim() && setOpen(false)}
    />
  );
}

function NewCard({ cells, add }: { cells: Record<string, unknown>; add: (cells: Record<string, unknown>, title: string) => Promise<number | null> }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  if (!open)
    return (
      <button type="button" className="w-full rounded-md px-2 py-1 text-left text-sm text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800" onClick={() => setOpen(true)}>
        + {t("New")}
      </button>
    );
  const save = async () => {
    const title = text.trim();
    if (!title) return setOpen(false);
    setBusy(true);
    const id = await add(cells, title);
    setBusy(false);
    if (id) setText("");
    field.current?.focus(); // the next one right away
  };
  return (
    <textarea
      ref={field}
      autoFocus
      rows={2}
      value={text}
      readOnly={busy}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          void save();
        } else if (e.key === "Escape") {
          setText("");
          setOpen(false);
        }
      }}
      onBlur={() => !text.trim() && setOpen(false)}
      placeholder={t("Title")}
      aria-label={t("New card")}
      className="ws-card w-full resize-none text-sm outline-none"
    />
  );
}

function ListView({ view, rows, visible, schema, ctx, api, labels, openRow }: ViewProps) {
  const t = useT();
  const groups = view.groupBy ? groupRows(rows, view.groupBy, schema.properties, labels) : [{ key: "", label: "", color: undefined as string | undefined, rows }];
  return (
    <div className="space-y-3">
      {groups.map((g) => (
        <div key={g.key || "all"}>
          {view.groupBy && <div className="mb-1 flex items-center gap-2 text-sm">{g.color ? <span className="ws-tag" data-color={g.color}>{g.label}</span> : <span className="font-medium text-zinc-500">{g.label || t("No value")}</span>}<span className="text-zinc-400">{g.rows.length}</span></div>}
          <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {g.rows.map((r) => (
              <li key={r.id} className="group/row flex flex-wrap items-center gap-2 px-2 py-1.5 text-sm">
                <span>{r.icon || "📄"}</span>
                <button type="button" className="min-w-0 truncate text-left font-medium hover:underline" onClick={() => openRow(r.id)}>
                  {r.title || <span className="text-zinc-400">{t("Untitled")}</span>}
                </button>
                <span className="flex flex-1 flex-wrap items-center justify-end gap-1.5">
                  {visible.slice(0, 5).map((p) => (
                    <PopCell key={p.id} p={p} row={r} ctx={ctx} />
                  ))}
                </span>
                <span className="opacity-0 group-hover/row:opacity-100">
                  <RowMenu row={r} api={api} />
                </span>
              </li>
            ))}
            {!g.rows.length && <li className="px-2 py-2 text-xs text-zinc-400">{t("Empty")}</li>}
          </ul>
        </div>
      ))}
    </div>
  );
}

function CalendarView({ view, rows, schema, api, openRow, newRow }: { view: View; rows: Row[]; schema: DbSchema; api: Api; openRow: (id: number) => void; newRow: (cells?: Record<string, unknown>, templateId?: number, open?: boolean) => Promise<void> }) {
  const t = useT();
  const prop = schema.properties.find((p) => p.id === view.dateProp);
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  if (!prop) return <p className="rounded-lg border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">{t("Choose the date property the calendar is laid out by.")}</p>;
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = new Date(first);
  start.setDate(1 - ((first.getDay() + 6) % 7));
  const days = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
  const byDay = new Map<string, Row[]>();
  for (const r of rows) {
    const rg = dateRange(r.cells[prop.id]);
    if (!rg) continue;
    const from = new Date(`${rg.start.slice(0, 10)}T00:00:00`);
    const to = new Date(`${(rg.end ?? rg.start).slice(0, 10)}T00:00:00`);
    for (let d = new Date(from), n = 0; d <= to && n < 62; d.setDate(d.getDate() + 1), n++) {
      const k = ymd(d);
      byDay.set(k, [...(byDay.get(k) ?? []), r]);
    }
  }
  const undated = rows.filter((r) => !dateRange(r.cells[prop.id]));
  const today = ymd(new Date());
  const names = [t("Mon"), t("Tue"), t("Wed"), t("Thu"), t("Fri"), t("Sat"), t("Sun")];
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <button type="button" className="btn btn-sm" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label={t("Previous month")}>
          ‹
        </button>
        <span className="min-w-32 text-center text-sm font-medium">{month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</span>
        <button type="button" className="btn btn-sm" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label={t("Next month")}>
          ›
        </button>
        <button type="button" className="btn btn-sm" onClick={() => setMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>
          {t("Today")}
        </button>
      </div>
      <div className="grid grid-cols-7 overflow-hidden rounded-lg border border-zinc-200 text-xs dark:border-zinc-800">
        {names.map((n) => (
          <div key={n} className="border-b border-zinc-200 bg-zinc-50 px-1.5 py-1 text-center font-medium text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/50">
            {n}
          </div>
        ))}
        {days.map((d) => {
          const k = ymd(d);
          const inMonth = d.getMonth() === month.getMonth();
          return (
            <div
              key={k}
              className={`group/day min-h-24 border-r border-b border-zinc-200 p-1 dark:border-zinc-800 ${inMonth ? "" : "bg-zinc-50/60 text-zinc-400 dark:bg-zinc-900/30"}`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const id = Number(e.dataTransfer.getData("text/ws-row"));
                const row = rows.find((r) => r.id === id);
                if (!row) return;
                const rg = dateRange(row.cells[prop.id]);
                if (!rg) return api.set(id, prop.id, k);
                // The span keeps its length.
                const days = Math.round((Date.parse(`${(rg.end ?? rg.start).slice(0, 10)}T00:00:00Z`) - Date.parse(`${rg.start.slice(0, 10)}T00:00:00Z`)) / 864e5);
                const to = new Date(`${k}T00:00:00`);
                to.setDate(to.getDate() + days);
                api.set(id, prop.id, days ? { start: k, end: ymd(to) } : k);
              }}
            >
              <div className="flex items-center justify-between">
                <span className={k === today ? "rounded-full bg-indigo-600 px-1.5 text-white" : ""}>{d.getDate()}</span>
                <button type="button" className="icon-btn opacity-0 group-hover/day:opacity-100" aria-label={t("New row on {day}", { day: k })} onClick={() => void newRow({ [prop.id]: k })}>
                  +
                </button>
              </div>
              <div className="space-y-0.5">
                {(byDay.get(k) ?? []).slice(0, 4).map((r) => (
                  <button key={r.id} type="button" draggable onDragStart={(e) => e.dataTransfer.setData("text/ws-row", String(r.id))} onClick={() => openRow(r.id)} className="block w-full truncate rounded bg-indigo-100 px-1 py-0.5 text-left text-indigo-900 hover:bg-indigo-200 dark:bg-indigo-950 dark:text-indigo-100" title={r.title}>
                    {r.icon} {r.title || t("Untitled")}
                  </button>
                ))}
                {(byDay.get(k)?.length ?? 0) > 4 && <span className="text-zinc-500">+{(byDay.get(k)?.length ?? 0) - 4}</span>}
              </div>
            </div>
          );
        })}
      </div>
      {undated.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-zinc-500">{t("{n} without a date", { n: undated.length })}</summary>
          <ul className="mt-1 flex flex-wrap gap-1">
            {undated.map((r) => (
              <li key={r.id}>
                <button type="button" className="ws-chip" onClick={() => openRow(r.id)}>
                  {r.title || t("Untitled")}
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/** A database shown in a page (a block): its own view, loaded when it appears. */
export function DatabaseBlock({ dbId, viewId, onView }: { dbId: number; viewId: string; onView: (id: string) => void }) {
  const t = useT();
  const router = useRouter();
  const [title, setTitle] = useState("");
  useEffect(() => {
    let live = true;
    void loadDatabaseAction(dbId).then((r) => live && r.ok && setTitle(r.data.title));
    return () => {
      live = false;
    };
  }, [dbId]);
  return (
    <div className="space-y-1">
      <button type="button" className="text-sm font-semibold hover:underline" onClick={() => router.push(`/workspace/${dbId}`)} title={t("Open as a page")}>
        🗂️ {title || t("Database")}
      </button>
      <DatabaseView initial={null} dbId={dbId} viewId={viewId} onView={onView} embedded />
    </div>
  );
}

/** The properties of a row at the top of its page: every property, editable in place. */
export function RowProperties({ initial, dbId, rowId }: { initial: DatabaseData; dbId: number; rowId: number }) {
  const t = useT();
  const api = useDatabase(initial, dbId);
  const data = api.data;
  const row = data?.rows.find((r) => r.id === rowId);
  if (!data || !row) return null;
  const ctx: CellCtx = { data, set: api.set, addOption: api.addOption, editable: !data.locked };
  if (!data.schema.properties.length) return null;
  return (
    <dl className="grid gap-x-4 gap-y-0.5 sm:grid-cols-[10rem_minmax(0,1fr)]" aria-label={t("Properties")}>
      {panelProperties(data.schema.properties).map((p) => (
        <div key={p.id} className="contents">
          <dt className="flex min-h-7 items-center text-sm text-zinc-500">{p.name}</dt>
          <dd className="flex min-h-7 flex-wrap items-center gap-1 text-sm">
            <PopCell p={p} row={row} ctx={ctx} />
          </dd>
        </div>
      ))}
    </dl>
  );
}
