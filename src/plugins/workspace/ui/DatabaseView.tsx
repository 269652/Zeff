"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { toast } from "@/components/Toaster";
import { useT } from "@/components/I18nProvider";
import { AiProgressBar, AiWorkingLabel, useAiWorkingOn } from "@/components/AiWorking";
import { chartViewAction, templateParamsAction, discardIfUntouchedAction, formFromTableAction, savePageAction, databasesAction, loadDatabaseAction, makeInboxAction, refreshPipelineAction, rowsMatchingAction, runPipelineAction, type DatabaseData } from "../actions";
import { hideRows, shownRows, cellText, filterByPeople, mineKeys, panelProperties, personChips, personPropOf, filterRows, isDayList, newView, sortRows, type Labels, type View, type ViewType } from "../model";
import { PopCell, type CellCtx } from "./cells";
import { RowPeek } from "./RowPeek";
import { GalleryView } from "./gallery";
import { BulkBar } from "./bulk";
import { EntryDialog, EntryFormSettings } from "./entry-form";
import { offersEntryForm } from "../form-spec";
import { RecurringDialog } from "./recurring";
import { ProtectDialog } from "./protect";
import { TimelineView } from "./timeline";
import { ChartView } from "./view-chart";
import { TodoView } from "./todo-view";
import { CardEditor } from "./card-editor";
import { FilterEditor, PropertiesMenu, SchemaModal, SortEditor } from "./db-menus";
import { Dropdown, MenuItem, Modal } from "./kit";
import { PipelineEditor, PipelineSummaries } from "./pipeline";
import { AppViewHost, appAvailable, type RowOps } from "./app-view";
import { ViewCode } from "./view-code";
import { viewAppMeta, TEMPLATE_VIEW } from "../view-apps";
import type { TplError } from "../view-template";
import { ShareDialog } from "./sheet";
import { DatabaseMenu, PLAIN_VIEWS, VIEW_ICON } from "./db-menu";
import { parseChartMarker } from "../legacy-blocks";
import { DatabaseAgents } from "./db-agents";
import { DAY_TABS, DayListTab, isDayTab, useDayTabLabels, type DayTab } from "./day-list";
import { useDatabase } from "./database/use-database";
import { INTERNAL_REFS, countRules, type Selection } from "./database/shared";
import { TryRules, AgentsModal, ReceiveModal } from "./database/modals";
import { PeopleBar } from "./database/people-bar";
import { TableView } from "./database/table-view";
import { BoardView } from "./database/board-view";
import { ListView } from "./database/list-view";
import { CalendarView } from "./database/calendar-view";
import { TicketPickBar, useForMe, useTicketPick } from "@/plugins/jira-lage/TicketPick";
import { decodePick, pickedIds, type PickCriteria } from "@/plugins/jira-lage/pick";

const noSubscribe = () => () => {};

/** A database on a page: its views (table, board, list, gallery, calendar), filters, sorts, groups, and the rows in place. */

export function DatabaseView({ initial, dbId, viewId, onView, embedded = false, openCode = false, bare = false, codeHead }: { initial: DatabaseData | null; dbId: number; viewId?: string; onView?: (id: string) => void; embedded?: boolean; /** Without its bar of views, search, filter and sort (the Studio lists the views itself). */ bare?: boolean; /** The code panel's header start (the Studio's title and buttons). */ codeHead?: React.ReactNode; /** An app view opens with its code (the Studio): closed, it stays closed for that view. */ openCode?: boolean }) {
  const t = useT();
  const router = useRouter();
  const api = useDatabase(initial, dbId);
  // The Workspace assistant working with this database open (its panel says so).
  const assistantHere = useAiWorkingOn(dbId);
  const dayLabels = useDayTabLabels();
  const { data } = api;
  const search = useSearchParams();
  // (A day list's own tab asked for by the link: ?day=stats.)
  const [current, setCurrent] = useState(viewId ?? (search.get("day") ? `day:${search.get("day")}` : ""));
  const [q, setQ] = useState("");
  // What was typed found on the rows' pages too (a document's whole text, a mail's body) — the server's answer, a moment later.
  const [pageHits, setPageHits] = useState<{ q: string; ids: Set<number> } | null>(null);
  useEffect(() => {
    const w = q.trim();
    if (!w) return;
    let gone = false;
    const timer = setTimeout(() => void rowsMatchingAction(dbId, w).then((ids) => !gone && setPageHits({ q: w, ids: new Set(ids) })), 250);
    return () => {
      gone = true;
      clearTimeout(timer);
    };
  }, [q, dbId]);
  const onPage = q.trim() && pageHits?.q === q.trim() ? pageHits.ids : undefined;
  const [schemaOpen, setSchemaOpen] = useState(false);
  const [cardOpen, setCardOpen] = useState(false);
  // ?steps=1 (a derived database just made): its Sources & steps open, to say what it keeps.
  const [pipelineOpen, setPipelineOpen] = useState(() => search.get("steps") === "1");
  const [justAdded, setJustAdded] = useState<number | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  // The entry form open in its dialog — "New" with one set (schema.entryForm), with the cells of where the row is made (a board
  // column, a calendar day, a group): its first answers.
  const [entry, setEntry] = useState<{ formId: number; cells: Record<string, unknown> } | null>(null);
  const [repeatOpen, setRepeatOpen] = useState(false);
  const [protectOpen, setProtectOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [asking, setAsking] = useState<{ id: number; title: string; names: string[] } | null>(null);
  // Rows ticked in the table (shift-click: a range): what the bulk bar acts on.
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const lastPicked = useRef<number | null>(null);
  // A narrow toolbar keeps the views, the search, "New" and "⋯": the rest goes into one "View" menu (the toolbar below says when).
  const [narrow, setNarrow] = useState(false);
  // (The toolbar is there only once the data is: watched from when it is drawn — a ref read in an effect missed it, so a
  // phone got the whole desktop toolbar.)
  const [bar, setBar] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!bar || typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(([e]) => setNarrow(e.contentRect.width < 780));
    watch.observe(bar);
    return () => watch.disconnect();
  }, [bar]);
  // Narrow: the search behind 🔍 until it is opened (or has a text).
  const [searchOpen, setSearchOpen] = useState(false);
  // A row opens over the database (?row=<id> — a link to it opens it again); the full page is a click further.
  const [peek, setPeek] = useState<number | null>(() => Number(search.get("row")) || null);
  // The panel is drawn in the browser only (a portal): the server's HTML has none, so nothing to mismatch.
  const inBrowser = useSyncExternalStore(noSubscribe, () => true, () => false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [agentsOpen, setAgentsOpen] = useState(false);
  const [databases, setDatabases] = useState<{ id: number; title: string; rules?: boolean; jobs?: boolean; people?: boolean }[]>([]);
  useEffect(() => {
    if (schemaOpen || pipelineOpen) void databasesAction().then((r) => r.ok && setDatabases(r.databases.map((d) => ({ id: d.id, title: d.title, rules: d.rules, jobs: d.jobs, people: d.people }))));
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
  // A mirrored Jira board: "Find tickets for me" (remembered per board), or the assistant's filter (?pick=…) — the rows it picks, in its order.
  const jiraBoard = (data?.extras?.source ?? "").startsWith("jira");
  const [forMe, setForMe] = useForMe(dbId);
  const pickParam = search.get("pick");
  const [urlPick, setUrlPick] = useState<PickCriteria | null>(() => decodePick(pickParam));
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- follows the address (a link from the assistant)
    setUrlPick(decodePick(pickParam));
  }, [pickParam]);
  const pickCriteria = useMemo<PickCriteria | null>(() => (!jiraBoard ? null : (urlPick ?? (forMe ? { forMe: true } : null))), [jiraBoard, urlPick, forMe]);
  const jiraMe = useMemo(() => [...(data?.extras?.jiraMe ?? []), ...(data?.extras?.me.names ?? [])], [data]);
  const pickRows = useMemo(() => (data && view ? shownRows(data.rows, data.schema, view) : undefined), [data, view]);
  const ticketPick = useTicketPick(data?.schema, pickRows, jiraMe, pickCriteria);
  const pickOff = () => {
    setForMe(false);
    setUrlPick(null);
    const u = new URL(window.location.href);
    if (u.searchParams.has("pick")) {
      u.searchParams.delete("pick");
      window.history.replaceState(null, "", u);
    }
  };
  const rows = useMemo(() => {
    if (!data || !view) return [];
    const props = data.schema.properties;
    // The rows hidden in the database left out (unless the view shows them too).
    let r = filterRows(shownRows(data.rows, data.schema, view), view.filter, props, labels);
    // A view kept as "only mine" shows only your rows, whatever is picked.
    const onlyMine = mine || !!view.mine;
    if (personProp && (onlyMine || people.size)) r = filterByPeople(r, personProp, onlyMine ? mineKeys(personProp, data.extras?.me ?? { names: [], ids: [] }) : people);
    const w = q.trim().toLowerCase();
    if (w) r = r.filter((x) => x.title.toLowerCase().includes(w) || props.some((p) => cellText(p, x.cells[p.id], labels).toLowerCase().includes(w)) || !!onPage?.has(x.id));
    if (ticketPick) {
      // Only the picked tickets, in the pick's order (yours first, then by priority).
      const at = new Map(pickedIds(ticketPick).map((id, i) => [id, i]));
      return r.filter((x) => at.has(x.id)).sort((a, b) => at.get(a.id)! - at.get(b.id)!);
    }
    return sortRows(r, view.sorts, props);
  }, [data, view, q, labels, personProp, mine, people, onPage, ticketPick]);
  // How many of its rows the database hides.
  const hiddenCount = data?.schema.hiddenRows?.length ? data.rows.filter((r) => data.schema.hiddenRows!.includes(r.id)).length : 0;

  // An app's view as code (its template being written — the view shows the draft), and what is wrong with the draft.
  const [code, setCodeRaw] = useState<{ viewId: string; draft: string } | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [codeErrors, setCodeErrors] = useState<TplError[]>([]);
  // The row New just made and opened (with the cells it got): closed again untouched, it goes — New leaves no empty rows behind.
  const fresh = useRef<{ id: number; madeWith: string[] } | null>(null);
  // An app's view can take "New" over (its own form for a new row — the debts overview's).
  const appNew = useRef<(() => void) | null>(null);
  const setAppNew = useCallback((fn: (() => void) | null) => void (appNew.current = fn), []);
  if (api.error && !data) return <p className="alert-error text-sm">{api.error}</p>;
  if (!data || !view) return <p className="py-6 text-sm text-zinc-500">{t("Loading …")}</p>;

  // (openCode: the app view picked starts with its code open — until it is closed.)
  const opened = code?.viewId === view.id ? code : openCode && view.type === "app" && dismissed !== view.id ? { viewId: view.id, draft: view.template ?? viewAppMeta(view.app ?? "")?.defaultTemplate(t) ?? "" } : code;
  const setCode = (c: { viewId: string; draft: string } | null) => {
    if (!c) setDismissed(opened?.viewId ?? null);
    setCodeRaw(c);
  };
  const schema = data.schema;
  // A day list (day-lists.ts): its own tabs first — Today unless a view was picked.
  const dayTab: DayTab | null = isDayList(schema) ? (isDayTab(current) ? current : current && schema.views.some((v) => v.id === current) ? null : "day:today") : null;
  // A locked database (one a sync keeps, as Jira's) is shown, not changed: its cells, cards and columns stay as they are.
  const ctx: CellCtx = { data, set: api.set, pending: api.isPending, press: api.press, addOption: api.addOption, editable: !data.locked, openRow: (id) => openRow(id) };
  const withRow = (id: number | null) => {
    const u = new URL(window.location.href);
    if (id) u.searchParams.set("row", String(id));
    else u.searchParams.delete("row");
    window.history.replaceState(null, "", u);
  };
  const openRow = (id: number) => {
    // A person is a page of their own (their profile, dates, what is known …): opened as one, not in a side panel.
    if (schema.dataType === "people" || schema.dataType === "cases") return void router.push(`/workspace/${id}`);
    setPeek(id);
    withRow(id);
  };
  const closePeek = () => {
    const made = fresh.current;
    fresh.current = null;
    setPeek(null);
    withRow(null);
    if (made && made.id === peek) void discardIfUntouchedAction(made.id, made.madeWith).then(() => api.reload());
    else void api.reload();
  };
  const setView = (v: View) => api.changeSchema((s) => ({ ...s, views: s.views.map((x) => (x.id === v.id ? v : x)) }));
  const pick = (id: string) => {
    setCurrent(id);
    onView?.(id);
  };
  // (Cards, lists, the calendar: where a row came from — "keep:n4", a source's key — is Zeff's, not a line to show; a table still has its column.)
  const visible = (view.order ? [...schema.properties].sort((a, b) => (view.order!.indexOf(a.id) + 1 || 999) - (view.order!.indexOf(b.id) + 1 || 999)) : schema.properties).filter((p) => !view.hidden.includes(p.id) && (view.type === "table" || !INTERNAL_REFS.has(p.id)));
  const filters = countRules(view.filter);
  const selection: Selection = {
    has: (id) => picked.has(id),
    any: picked.size > 0,
    toggle: (id, range, order) => {
      setPicked((cur) => {
        const next = new Set(cur);
        if (range && lastPicked.current !== null) {
          const a = order.indexOf(lastPicked.current);
          const b = order.indexOf(id);
          if (a >= 0 && b >= 0) for (const x of order.slice(Math.min(a, b), Math.max(a, b) + 1)) next.add(x);
        } else if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      lastPicked.current = id;
    },
    all: (ids) => setPicked((cur) => (ids.every((x) => cur.has(x)) ? new Set() : new Set(ids))),
  };

  const addView = (type: ViewType, app?: { id: string; label: string }) => {
    const names: Record<ViewType, string> = { table: t("Table"), board: t("Board"), list: t("List"), gallery: t("Gallery"), calendar: t("Calendar"), timeline: t("Timeline"), chart: t("Chart"), todo: t("Todos"), app: app?.label ?? t("App") };
    const v = newView(names[type], type);
    if (app) v.app = app.id;
    if (type === "board") v.groupBy = schema.properties.find((p) => p.type === "status" || p.type === "select")?.id;
    if (type === "calendar" || type === "timeline") v.dateProp = schema.properties.find((p) => p.type === "date")?.id;
    if (type === "chart") v.groupBy = schema.properties.find((p) => p.type === "status" || p.type === "select")?.id;
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

  // Where a new row can be named in place: a table (an app's view without its app is one) — anywhere else it opens.
  const inPlace = !!view && !!data && (view.type === "table" || (view.type === "app" && !appAvailable(data, view)));
  // A new row where the entry form is set: the form opens, prefilled with these cells (none set: undefined).
  const onForm = schema.entryForm ? (cells: Record<string, unknown> = {}) => setEntry({ formId: schema.entryForm!, cells }) : undefined;
  const newRow = async (cells: Record<string, unknown> = {}, templateId?: number, open = false, params?: Record<string, string>) => {
    if (onForm && !templateId) return onForm(cells);
    const id = await api.addRow(cells, "", templateId, params);
    if (!id) return;
    // A row from a template opens as a page; a plain one is named in place.
    if (open && !templateId) fresh.current = { id, madeWith: Object.keys(cells) };
    if (open) openRow(id);
    else setJustAdded(id);
  };

  // What a view's buttons do to rows (a template's new, delete, duplicate, hide).
  const rowOps: RowOps = {
    add: async (cells, title = "") => {
      const id = await api.addRow(cells, title);
      if (id && !title) fresh.current = { id, madeWith: Object.keys(cells) };
      return id;
    },
    remove: (id) => api.removeRow(id),
    duplicate: (id) => api.duplicateRow(id),
    hide: (id) => api.changeSchema((s) => hideRows(s, [id], true)),
  };

  // A narrow toolbar keeps the views, the search, "New" and "⋯" - filter, sort, grouping, the date field and the properties go into one "View" menu.
  const groupNode = (
    <>
    {(view.type === "board" || view.type === "table" || view.type === "list" || view.type === "chart") && (
      <select className="input w-auto text-sm" value={view.groupBy ?? ""} aria-label={t("Group by")} onChange={(e) => setView({ ...view, groupBy: e.target.value || undefined })}>
        <option value="">{view.type === "board" ? t("Group by …") : t("No grouping")}</option>
        {schema.properties.filter((p) => ["select", "status", "multi_select", "person", "checkbox", "relation", ...(view.type === "chart" ? ["date", "text"] : [])].includes(p.type)).map((p) => (
          <option key={p.id} value={p.id}>
            {t("Group by {name}", { name: p.name })}
          </option>
        ))}
      </select>
    )}
    </>
  );
  const dateNode = (
    <>
    {view.type === "timeline" && (
      <select className="input w-auto text-sm" value={view.endProp ?? ""} aria-label={t("End date property")} onChange={(e) => setView({ ...view, endProp: e.target.value || undefined })}>
        <option value="">{t("Ends at … (the date's own end)")}</option>
        {schema.properties.filter((p) => p.type === "date" && p.id !== view.dateProp).map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    )}
    {view.type === "chart" && (
      <>
        <select className="input w-auto text-sm" value={view.chartKind ?? "column"} aria-label={t("Chart type")} onChange={(e) => setView({ ...view, chartKind: e.target.value as "bar" })}>
          <option value="column">{t("Columns")}</option>
          <option value="bar">{t("Bars")}</option>
          <option value="line">{t("Line")}</option>
          <option value="pie">{t("Pie")}</option>
        </select>
        <select className="input w-auto text-sm" value={view.chartProp ? `${view.chartCalc ?? "sum"}:${view.chartProp}` : "count"} aria-label={t("What is counted")} onChange={(e) => (e.target.value === "count" ? setView({ ...view, chartCalc: undefined, chartProp: undefined }) : setView({ ...view, chartCalc: e.target.value.split(":")[0] as "sum", chartProp: e.target.value.split(":")[1] }))}>
          <option value="count">{t("Number of rows")}</option>
          {schema.properties.filter((p) => p.type === "number").flatMap((p) => [
            <option key={`s${p.id}`} value={`sum:${p.id}`}>{t("Sum of {name}", { name: p.name })}</option>,
            <option key={`a${p.id}`} value={`avg:${p.id}`}>{t("Average of {name}", { name: p.name })}</option>,
          ])}
        </select>
      </>
    )}
    {(view.type === "calendar" || view.type === "timeline") && (
      <select className="input w-auto text-sm" value={view.dateProp ?? ""} aria-label={t("Date property")} onChange={(e) => setView({ ...view, dateProp: e.target.value || undefined })}>
        <option value="">{t("Date by …")}</option>
        {schema.properties.filter((p) => p.type === "date").map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    )}
    </>
  );
  const propsDropdown = (
    <>
    <Dropdown label={t("Properties")} align="right" className="btn btn-sm">
      {() => <PropertiesMenu view={view} schema={schema} onChange={setView} />}
    </Dropdown>
    </>
  );
  const controlsNode = (
    <>
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
      {groupNode}
      {dateNode}
    </>
  );
  const viewMenu = (
    <Dropdown label={`${t("View")}${filters + view.sorts.length ? ` · ${filters + view.sorts.length}` : ""}`} align="right" className={`btn btn-sm ${filters + view.sorts.length ? "text-indigo-600 dark:text-indigo-400" : ""}`}>
      {() => (
        <div className="w-[min(32rem,92vw)] space-y-2 p-2 text-sm">
          <details>
            <summary className="cursor-pointer py-1 font-medium">{`${t("Filter")}${filters ? ` · ${filters}` : ""}`}</summary>
            <div className="pt-1">
              <FilterEditor filter={view.filter} schema={schema} data={data} onChange={(filter) => setView({ ...view, filter })} />
            </div>
          </details>
          <details>
            <summary className="cursor-pointer py-1 font-medium">{`${t("Sort")}${view.sorts.length ? ` · ${view.sorts.length}` : ""}`}</summary>
            <div className="pt-1">
              <SortEditor sorts={view.sorts} schema={schema} onChange={(sorts) => setView({ ...view, sorts })} />
            </div>
          </details>
          <div className="flex flex-wrap items-center gap-2">
            {groupNode}
            {dateNode}
          </div>
          <details>
            <summary className="cursor-pointer py-1 font-medium">{t("Properties")}</summary>
            <div className="pt-1">
              <PropertiesMenu view={view} schema={schema} onChange={setView} />
            </div>
          </details>
        </div>
      )}
    </Dropdown>
  );

  const countText = rows.length === data.rows.length ? (rows.length === 1 ? t("1 row") : t("{n} rows", { n: rows.length })) : t("{n} of {total} rows", { n: rows.length, total: data.rows.length });
  // (A table says it in its footer: no line of its own under it.)
  const countInTable = !dayTab && view.type === "table" && rows.length > 0;
  // An app of its own (<panes>): it has its search, filters and counts, the table's tools around it would only compete.
  const appScreen = view.type === "app" && /<panes\b/.test(view.template ?? "");
  return (
    <div className="space-y-2">
      <div ref={setBar} className={`${bare ? "hidden" : "flex"} items-center gap-1 ${narrow ? "flex-nowrap" : "flex-wrap"}`}>
        {/* Narrow (a phone): one row — the views scroll sideways instead of wrapping into rows of their own. */}
        <div className={`flex min-w-0 items-center gap-0.5 ${narrow ? "flex-1 flex-nowrap overflow-x-auto [scrollbar-width:none]" : "flex-wrap"}`}>
          {/* The views are the tabs; "+" beside them is no tab. */}
          <div role="tablist" aria-label={t("Views")} className="contents">
            {isDayList(schema) &&
              DAY_TABS.map((d) => (
                <button key={d} type="button" role="tab" aria-selected={d === dayTab} onClick={() => pick(d)} className={`shrink-0 rounded-md px-2 py-1 text-sm whitespace-nowrap ${d === dayTab ? "bg-zinc-100 font-medium dark:bg-zinc-800" : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}>
                  {dayLabels[d]}
                </button>
              ))}
            {schema.views.map((v) => (
              <button key={v.id} type="button" role="tab" aria-selected={!dayTab && v.id === view.id} onClick={() => pick(v.id)} className={`shrink-0 rounded-md px-2 py-1 text-sm whitespace-nowrap ${!dayTab && v.id === view.id ? "bg-zinc-100 font-medium dark:bg-zinc-800" : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}>
                {v.type === "app" ? (data.extras?.appViews?.find((a) => a.id === v.app)?.icon ?? VIEW_ICON.app) : VIEW_ICON[v.type]} {v.name}
              </button>
            ))}
          </div>
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
                  {VIEW_ICON[vt]} {{ table: t("Table"), board: t("Board"), list: t("List"), gallery: t("Gallery"), calendar: t("Calendar"), timeline: t("Timeline"), chart: t("Chart"), todo: t("Todos"), app: "" }[vt]}
                </MenuItem>
              )),
              // The apps' views this database can have (its type: mails, messages — their plugins installed).
              // A database that is no inbox yet: "Inbox" names the channels as its sources (and shows them by the inbox view).
              ...((!schema.dataType || schema.dataType === "mail" || schema.dataType === "message") && data.extras?.inboxPossible
                ? [
                    <MenuItem
                      key="make-inbox"
                      onClick={() => {
                        close();
                        void makeInboxAction(data.id).then((r) => (r.ok ? (toast(t("The channels are its sources now — the Inbox view follows."), { tone: "ok" }), router.refresh()) : toast(r.error, { tone: "error" })));
                      }}
                    >
                      📬 {t("Inbox")}
                    </MenuItem>,
                  ]
                : []),
              // A view of any table built from its template (written by hand or by the AI).
              <MenuItem
                key="app-template"
                onClick={() => {
                  addView("app", { id: "template", label: t("Template") });
                  close();
                }}
              >
                🧩 {t("Template (code / AI)")}
              </MenuItem>,
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
        {!narrow && <span className="flex-1" />}
        {appScreen ? null : !narrow || searchOpen || q ? (
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} onBlur={() => !q && setSearchOpen(false)} autoFocus={narrow && searchOpen} placeholder={t("Search …")} aria-label={t("Search the rows")} className={`input text-sm ${narrow ? "w-28 shrink-0" : "w-36"}`} />
        ) : (
          <button type="button" className="icon-btn shrink-0" title={t("Search the rows")} aria-label={t("Search the rows")} onClick={() => setSearchOpen(true)}>
            🔍
          </button>
        )}
        {!narrow && !dayTab && !appScreen && controlsNode}
        {narrow && !dayTab && viewMenu}
        {!narrow && schema.pipeline?.steps.some((s) => s.kind === "source") && !data.extras?.source && (
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
        {!narrow && !dayTab && !appScreen && propsDropdown}
        {/* A rules database: its rules tried on what the pipelines read — per rule, what it would hit; nothing written (rules.ts). */}
        {data.schema.rules && <TryRules dbId={dbId} />}
        {!narrow && !dayTab && (view.type === "board" || view.type === "gallery") && (
          <button type="button" className={`btn btn-sm ${view.card ? "text-indigo-600 dark:text-indigo-400" : ""}`} title={t("How the cards look — a card template")} onClick={() => setCardOpen(true)}>
            {t("Card")}
          </button>
        )}
        <DatabaseMenu
          dbId={dbId}
          data={data}
          schema={schema}
          view={view}
          narrow={narrow}
          hiddenCount={hiddenCount}
          hasPerson={!!personProp}
          codeOpen={opened?.viewId === view.id}
          toggleCode={() => setCode(opened?.viewId === view.id ? null : { viewId: view.id, draft: view.template ?? viewAppMeta(view.app!)?.defaultTemplate(t) ?? "" })}
          resetTemplate={() => (setView({ ...view, template: undefined }), setCode(null))}
          open={(d) => ({ card: setCardOpen, schema: setSchemaOpen, form: setFormOpen, repeat: setRepeatOpen, protect: setProtectOpen, share: setShareOpen, pipeline: setPipelineOpen, receive: setReceiveOpen, agents: setAgentsOpen })[d](true)}
          setView={setView}
          pick={pick}
          changeSchema={api.changeSchema}
          reload={api.reload}
          ranText={ranText}
        />
        <div className={`flex shrink-0 ${data.locked || data.noNewRows ? "hidden" : ""}`}>
          <button type="button" className="btn btn-primary btn-sm rounded-r-none" title={t("New")} aria-label={t("New")} onClick={() => (!dayTab && view.type === "app" && appNew.current ? appNew.current() : void newRow({}, undefined, !inPlace || !!dayTab))}>
            {narrow ? "+" : t("New")}
          </button>
          <Dropdown label="▾" align="right" title={t("New from a template")} wrapClassName="relative flex" className="btn btn-primary btn-sm h-auto rounded-l-none border-l border-indigo-400 px-1.5">
            {(close) => (
              <>
                {data.templates.map((tp) => (
                  <MenuItem
                    key={tp.id}
                    onClick={async () => {
                      close();
                      // A template with {{placeholders}} asks for their values first.
                      const r = await templateParamsAction(tp.id);
                      if (r.ok && r.params.length) setAsking({ id: tp.id, title: tp.title, names: r.params });
                      else void newRow({}, tp.id, true);
                    }}
                  >
                    📋 {tp.title}
                  </MenuItem>
                ))}
                {offersEntryForm(schema) && (
                  <MenuItem
                    onClick={async () => {
                      close();
                      // A form asking every column, made now and set as the entry form — and opened to fill in.
                      const r = await formFromTableAction(dbId);
                      if (!r.ok) return void toast(r.error, { tone: "error" });
                      await api.reload();
                      setEntry({ formId: r.id, cells: {} });
                    }}
                  >
                    📝 {t("New with a form …")}
                  </MenuItem>
                )}
                {!data.templates.length && <p className="max-w-56 px-2 py-1.5 text-xs text-zinc-500">{t("No templates yet — open a row and choose “Use as a template” in its menu.")}</p>}
              </>
            )}
          </Dropdown>
        </div>
      </div>

      {jiraBoard && !dayTab && view.type !== "app" && (
        <TicketPickBar
          on={!!pickCriteria?.forMe}
          onToggle={() => (pickCriteria?.forMe ? pickOff() : (pickOff(), setForMe(true)))}
          pick={ticketPick}
          criteria={pickCriteria}
          meKnown={jiraMe.length > 0}
          openRow={(id) => openRow(id)}
          onOff={pickOff}
        />
      )}
      {/* Not over an app's view (the creditors overview, the cases): it has its own say of whom it shows. */}
      {personProp && !dayTab && view.type !== "app" && (
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

      {(data.extras?.running || assistantHere) && (
        <div className="space-y-1.5" data-running>
          <AiProgressBar />
          <AiWorkingLabel label={data.extras?.running ? t("The AI is going through the rows — they change as it writes them …") : t("The assistant is working on this database …")} />
        </div>
      )}
      <PipelineSummaries pipeline={schema.pipeline} />
      <DatabaseAgents dbId={dbId} />
      {dayTab && <DayListTab tab={dayTab} dbId={dbId} data={data} set={api.set} saved={api.saved} reload={api.reload} logView={(logId) => <DatabaseView initial={null} dbId={logId} embedded />} />}
      {!dayTab && view.type === "app" && opened?.viewId === view.id && (
        <ViewCode
          view={view}
          dbId={dbId}
          head={codeHead}
          fields={[schema.titleName, ...schema.properties.filter((p) => !p.id.startsWith("src")).map((p) => p.name)]}
          meta={viewAppMeta(view.app ?? "") ?? TEMPLATE_VIEW}
          draft={opened.draft}
          setDraft={(draft) => setCode({ viewId: view.id, draft })}
          errors={codeErrors}
          onClose={() => setCode(null)}
          onSave={(template) => {
            setView({ ...view, template: template ?? undefined });
            setCodeRaw(null);
            toast(template ? t("The view is saved.") : t("The view is back to its default."), { tone: "ok" });
          }}
          onNewView={(template, name) => {
            const v = { ...newView(name || t("New view"), "app"), app: view.app, template };
            api.changeSchema((s) => ({ ...s, views: [...s.views, v] }));
            setCode({ viewId: v.id, draft: template });
            pick(v.id);
          }}
        />
      )}
      {!dayTab && view.type === "app" && <AppViewHost view={view} data={data} rows={rows} openRow={openRow} reload={() => void api.reload()} onNew={setAppNew} ctx={ctx} rowOps={rowOps} src={opened?.viewId === view.id ? opened.draft : undefined} onErrors={opened?.viewId === view.id ? setCodeErrors : undefined} fallback={<TableView view={view} rows={rows} visible={visible} schema={schema} ctx={ctx} api={api} labels={labels} openRow={openRow} setView={setView} onSchema={() => setSchemaOpen(true)} justAdded={justAdded} onEdited={() => setJustAdded(null)} />} />}
      {!dayTab && view.type === "table" && picked.size > 0 && <BulkBar ids={[...picked]} schema={schema} dbId={dbId} onChanged={() => void api.reload()} onClear={() => setPicked(new Set())} onHide={(hide) => (api.changeSchema((s) => hideRows(s, [...picked], hide)), setPicked(new Set()))} />}
      {!dayTab && view.type === "table" && <TableView count={countInTable ? countText : undefined} onForm={onForm} fill={!embedded} sel={selection} view={view} rows={rows} visible={visible} schema={schema} ctx={ctx} api={api} labels={labels} openRow={openRow} setView={setView} onSchema={() => setSchemaOpen(true)} justAdded={justAdded} onEdited={() => setJustAdded(null)} />}
      {!dayTab && view.type === "board" && <BoardView view={view} rows={rows} visible={visible} schema={schema} ctx={ctx} api={api} labels={labels} openRow={openRow} newRow={newRow} onForm={onForm} />}
      {!dayTab && view.type === "list" && <ListView view={view} rows={rows} visible={visible} schema={schema} ctx={ctx} api={api} labels={labels} openRow={openRow} />}
      {!dayTab && view.type === "gallery" && <GalleryView rows={rows} visible={visible} ctx={ctx} openRow={openRow} add={(cells, title) => api.addRow(cells, title)} onForm={onForm} locked={!!data.locked || !!data.noNewRows} template={view.card} />}
      {!dayTab && view.type === "timeline" && <TimelineView view={view} rows={rows} schema={schema} api={api} openRow={openRow} locked={!!data.locked} />}
      {!dayTab && view.type === "todo" && <TodoView dbId={dbId} rows={rows} schema={schema} api={api} openRow={openRow} locked={!!data.locked} canAdd={!data.noNewRows} />}
      {!dayTab && view.type === "chart" && <ChartView view={view} rows={rows} schema={schema} />}
      {!dayTab && view.type === "calendar" && <CalendarView canAdd={!data.noNewRows} view={view} rows={rows} schema={schema} api={api} openRow={openRow} newRow={newRow} />}
      {!appScreen && (!countInTable || hiddenCount > 0) && <p className="text-xs text-zinc-500">
        {!countInTable && countText}
        {hiddenCount > 0 && (
          <>
            {!countInTable && " · "}
            <button type="button" className="hover:underline" onClick={() => setView({ ...view, showHidden: !view.showHidden })}>
              {view.showHidden ? t("{n} hidden shown — leave them out", { n: hiddenCount }) : t("{n} hidden — show", { n: hiddenCount })}
            </button>
          </>
        )}
      </p>}

      {asking && (
        <Modal title={asking.title} onClose={() => setAsking(null)}>
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              const params = Object.fromEntries(asking.names.map((n, i) => [n, String(fd.get(`p${i}`) ?? "")]));
              const id = asking.id;
              setAsking(null);
              void newRow({}, id, true, params);
            }}
          >
            <p className="text-sm text-zinc-500">{t("This template asks for:")}</p>
            {asking.names.map((n, i) => (
              <label key={n} className="block space-y-1">
                <span className="label">{n}</span>
                <input name={`p${i}`} className="input text-sm" autoFocus={i === 0} />
              </label>
            ))}
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" className="btn btn-sm" onClick={() => setAsking(null)}>
                {t("Cancel")}
              </button>
              <button className="btn btn-primary btn-sm">{t("Create")}</button>
            </div>
          </form>
        </Modal>
      )}
      {protectOpen && <ProtectDialog schema={schema} onSave={api.saveSchema} onClose={() => setProtectOpen(false)} />}
      {shareOpen && <ShareDialog dbId={dbId} schema={schema} title={data.title} onDone={() => void api.reload()} onClose={() => setShareOpen(false)} />}
      {repeatOpen && <RecurringDialog dbId={dbId} schema={schema} templates={data.templates} onClose={() => setRepeatOpen(false)} />}
      {formOpen && <EntryFormSettings dbId={dbId} current={schema.entryForm ?? null} onSaved={() => void api.reload()} onClose={() => setFormOpen(false)} />}
      {entry && (
        <EntryDialog
          formId={entry.formId}
          prefill={entry.cells}
          onClose={() => setEntry(null)}
          onDone={(id, updated) => {
            setEntry(null);
            void api.reload();
            // (A form that only changes rows makes none: what it changed is said.)
            if (id !== null) toast(t("Added ✓"), { action: { label: t("Open it"), run: () => openRow(id) } });
            else toast(updated === 1 ? t("1 entry updated.") : t("{n} entries updated.", { n: updated }));
          }}
        />
      )}
      {cardOpen && <CardEditor view={view} schema={schema} rows={rows} data={data} keys={data.extras?.keys ?? {}} onSave={(card) => setView({ ...view, card })} onClose={() => setCardOpen(false)} />}
      {schemaOpen && <SchemaModal schema={schema} data={data} dbId={dbId} databases={databases} onSave={api.saveSchema} onClose={() => setSchemaOpen(false)} />}
      {agentsOpen && <AgentsModal schema={schema} dbId={dbId} onSaved={() => api.reload()} onClose={() => setAgentsOpen(false)} />}
      {receiveOpen && <ReceiveModal schema={schema} dbId={dbId} onSaved={() => api.reload()} onClose={() => setReceiveOpen(false)} />}
      {pipelineOpen && (
        <PipelineEditor
          dbId={dbId}
          pipeline={schema.pipeline}
          synced={data.extras?.source ?? null}
          dataType={schema.dataType}
          fields={schema.properties.filter((p) => !["srcref", "srcedited", "srcurl", "ticketkey", "noteref"].includes(p.id)).map((p) => p.name)}
          checkboxes={schema.properties.filter((p) => p.type === "checkbox").map((p) => ({ id: p.id, name: p.name }))}
          databases={databases}
          extSources={data.extras?.extSources}
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

/** Where a page in its expanded view puts the titles of its database blocks (PageView's breadcrumb). */
export const CRUMB_SLOT = "ws-crumb-slot";

/** A database shown in a page (a block): its own view, loaded when it appears. */
export function DatabaseBlock({ dbId, viewId, onView, blockTitle = "" }: { dbId: number; viewId: string; onView: (id: string) => void; /** The block's own title (an old chart block's: the name of the chart view it becomes). */ blockTitle?: string }) {
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
  // An old chart block (legacy-blocks.ts): the chart view it stands for, found or made, and the block shows it from now on.
  const marker = parseChartMarker(viewId) ? viewId : "";
  const onViewRef = useRef(onView);
  useEffect(() => {
    onViewRef.current = onView;
  });
  useEffect(() => {
    if (!marker) return;
    void chartViewAction(dbId, marker, blockTitle).then((r) => (r.ok ? onViewRef.current(r.viewId) : toast(r.error, { tone: "error" })));
  }, [dbId, marker, blockTitle]);
  // A page in its expanded view (an app — the Agenda): the title goes into the breadcrumb, a click there shows it here again.
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [reveal, setReveal] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setSlot(document.getElementById(CRUMB_SLOT)));
    return () => cancelAnimationFrame(id);
  }, []);
  if (marker) return <p className="text-sm text-zinc-400">…</p>;
  const name = `🗂️ ${title || t("Database")}`;
  return (
    <div className="space-y-1">
      {slot &&
        createPortal(
          <span className="flex items-center gap-1">
            ›
            <button type="button" className="max-w-48 truncate hover:underline" aria-expanded={reveal} title={t("Title")} onClick={() => setReveal(!reveal)}>
              {name}
            </button>
          </span>,
          slot,
        )}
      {(!slot || reveal) && (
        <button type="button" className="text-sm font-semibold hover:underline" onClick={() => router.push(`/workspace/${dbId}`)} title={t("Open as a page")}>
          {name}
        </button>
      )}
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
  const ctx: CellCtx = { data, set: api.set, pending: api.isPending, press: api.press, addOption: api.addOption, editable: !data.locked };
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

/** One field of a row, edited in place (a field block of a layout): its name beside it — or without. */
export function RowField({ initial, dbId, rowId, propId, showLabel = true }: { initial: DatabaseData; dbId: number; rowId: number; propId: string; showLabel?: boolean }) {
  const t = useT();
  const api = useDatabase(initial, dbId);
  const data = api.data;
  const row = data?.rows.find((r) => r.id === rowId);
  if (!data || !row) return null;
  const ctx: CellCtx = { data, set: api.set, pending: api.isPending, press: api.press, addOption: api.addOption, editable: !data.locked };
  const p = data.schema.properties.find((x) => x.id === propId);
  const name = propId === "title" ? data.schema.titleName : (p?.name ?? "");
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm" data-row-field={propId}>
      {showLabel && name && <span className="w-32 shrink-0 text-zinc-500">{name}</span>}
      <span className="flex min-h-7 min-w-0 flex-1 flex-wrap items-center gap-1">
        {propId === "title" ? (
          <input defaultValue={row.title} readOnly={!!data.locked} aria-label={name} className="w-full bg-transparent font-medium outline-none" onBlur={(e) => e.target.value !== row.title && void savePageAction(rowId, { title: e.target.value })} />
        ) : p ? (
          <PopCell p={p} row={row} ctx={ctx} />
        ) : (
          <span className="text-zinc-400">{t("This field is gone.")}</span>
        )}
      </span>
    </div>
  );
}
