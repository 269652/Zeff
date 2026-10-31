"use client";

import { confirmAction } from "@/components/confirm";
import { useRouter } from "next/navigation";
import { toast } from "@/components/Toaster";
import { useT } from "@/components/I18nProvider";
import { createDerivedDatabaseAction, exportDatabaseCsvAction, formFromTableAction, refreshPipelineAction, reviewDatabaseAction, runOpenJobsAction, setDatabaseLabelAction, setDayListAction, setNavPlaceAction, type DatabaseData } from "../actions";
import { isDayList, newId, VIEW_TYPES, type DbSchema, type View, type ViewType } from "../model";
import { viewAppMeta } from "../view-apps";
import { appAvailable } from "./app-view";
import { Dropdown, MenuItem, MenuSection } from "./kit";

/**
 * A database's "⋯" menu: what is set on the database and its view, in five headed sections — Fields & forms, Data & sources,
 * Automation, Sharing & protection, View. A section shows only what this database and view offer (no agents: no "Agents …").
 */

/** The sign of each kind of view, and the kinds a view can be shown as (not an app's). */
export const VIEW_ICON: Record<ViewType, string> = { table: "▦", board: "▥", list: "☰", gallery: "▤", calendar: "📅", timeline: "▬", chart: "📊", todo: "☑", app: "◫" };
export const PLAIN_VIEWS = VIEW_TYPES.filter((v) => v !== "app");

/** The dialogs of the database view the menu opens. */
export type DbDialog = "card" | "schema" | "form" | "repeat" | "protect" | "share" | "pipeline" | "receive" | "agents";

type RunResult = { records: number; created: number; updated: number; archived: number; background: boolean; already: boolean };

export function DatabaseMenu(p: {
  dbId: number;
  data: DatabaseData;
  schema: DbSchema;
  view: View;
  /** A narrow toolbar: what it left out (the refresh, the card template) is here. */
  narrow: boolean;
  hiddenCount: number;
  /** The database has a person field ("Only mine"). */
  hasPerson: boolean;
  /** The view's code is open. */
  codeOpen: boolean;
  toggleCode: () => void;
  resetTemplate: () => void;
  open: (d: DbDialog) => void;
  setView: (v: View) => void;
  pick: (viewId: string) => void;
  changeSchema: (fn: (s: DbSchema) => DbSchema) => void;
  reload: () => Promise<unknown>;
  ranText: (r: RunResult, syncing: string[]) => string;
}) {
  const t = useT();
  const router = useRouter();
  const { dbId, data, schema, view, narrow, setView } = p;
  const template = view.template ?? viewAppMeta(view.app ?? "")?.defaultTemplate(t) ?? "";
  const hasNav = view.type === "app" && (data.extras?.appViews?.find((a) => a.id === view.app)?.nav || /<nav[\s>]/.test(template));
  const hasAi = schema.properties.some((x) => x.type === "ai");
  return (
    <Dropdown label="⋯" align="right" title={t("More")} className="btn btn-sm shrink-0">
      {(close) => (
        <>
          <MenuSection title={t("Fields & forms")}>
            <MenuItem onClick={() => (close(), p.open("schema"))}>⚙ {t("Edit properties …")}</MenuItem>
            <MenuItem checked={!!schema.entryForm} onClick={() => (close(), p.open("form"))}>
              📝 {t("Entry form …")}
            </MenuItem>
            <MenuItem onClick={() => (close(), void formFromTableAction(dbId).then((r) => (r.ok ? router.push(`/workspace/${r.id}`) : toast(r.error, { tone: "error" }))))}>📝 {t("Make a form from this table")}</MenuItem>
          </MenuSection>

          <MenuSection title={t("Data & sources")}>
            {/* Narrow: the refresh from the sources the toolbar left out. */}
            {narrow && schema.pipeline?.steps.some((s) => s.kind === "source") && !data.extras?.source && (
              <MenuItem
                onClick={async () => {
                  close();
                  const r = await refreshPipelineAction(dbId);
                  await p.reload();
                  if (!r.ok) return void toast(r.error, { tone: "error" });
                  toast(p.ranText(r, r.syncing), { tone: "ok" });
                }}
              >
                ↻ {t("Refresh from the sources")}
              </MenuItem>
            )}
            <MenuItem onClick={() => (close(), p.open("pipeline"))}>⛓ {t("Sources & steps …")}</MenuItem>
            <MenuItem onClick={() => (close(), p.open("receive"))}>➜ {t("Receive tickets …")}</MenuItem>
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
            {/* What goes out of it (into the Ticket-Lage; the knowledge server picks for itself): the Workspace's settings. */}
            <MenuItem onClick={() => (close(), router.push(`/workspace/settings/outputs#db-${dbId}`))}>📤 {t("Outputs …")}</MenuItem>
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
          </MenuSection>

          <MenuSection title={t("Automation")}>
            <MenuItem onClick={() => (close(), p.open("repeat"))}>🔁 {t("Repeating rows …")}</MenuItem>
            {/* A day list (day-lists.ts): ticked through every day, its days kept in a log — its tabs Today, History, Figures. */}
            <MenuItem
              onClick={async () => {
                close();
                const on = !isDayList(schema);
                if (!on && !confirmAction(t("Stop being a day list? It no longer starts again at 4:00; its history stays (as a database under it)."))) return;
                const r = await setDayListAction(dbId, on);
                if (!r.ok) return void toast(r.error, { tone: "error" });
                await p.reload();
                if (on) p.pick("day:today");
                router.refresh();
              }}
            >
              🔁 {isDayList(schema) ? t("Stop being a day list") : t("Use as a day list")}
            </MenuItem>
            {schema.jobs && <MenuItem onClick={() => (close(), p.open("agents"))}>🤖 {t("Agents …")}</MenuItem>}
            {schema.jobs && (
              <MenuItem
                onClick={async () => {
                  close();
                  const r = await runOpenJobsAction(dbId);
                  await p.reload();
                  if (!r.ok) return void toast(r.error, { tone: "error" });
                  toast(t("{n} jobs given to workers.", { n: r.started }) + (r.failed.length ? ` ${r.failed[0]}` : ""), { tone: r.failed.length ? "error" : "ok" });
                }}
              >
                ▶ {t("Start all open jobs")}
              </MenuItem>
            )}
            {hasAi && (
              <>
                <MenuItem checked={!!schema.review?.on} onClick={() => (close(), p.changeSchema((s) => ({ ...s, review: { on: !s.review?.on } })))}>
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
          </MenuSection>

          <MenuSection title={t("Sharing & protection")}>
            <MenuItem onClick={() => (close(), p.open("protect"))}>🛡 {t("Protection …")}</MenuItem>
            <MenuItem checked={!!schema.share} onClick={() => (close(), p.open("share"))}>
              ƒ {t("Share for formulas …")}
              {schema.share ? ` (${schema.share.name})` : ""}
            </MenuItem>
            {/* How sensitive it is (open, personal, secret): what may flow out of it at all — Settings → Data boundaries. */}
            <div className="flex items-center gap-1 px-2 py-1 text-sm" title={t("Personal: agents only with permission. Secret: never leaves Zeff — no knowledge, briefing, agents or AI.")}>
              <span aria-hidden>{data.extras?.sensitivity && data.extras.sensitivity !== "open" ? "🔒" : "🔓"}</span>
              <span className="mr-auto text-zinc-500">{t("Sensitivity")}</span>
              {(["open", "personal", "secret"] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  aria-pressed={(data.extras?.sensitivity ?? "open") === l}
                  className={`rounded px-1.5 py-0.5 text-xs ${(data.extras?.sensitivity ?? "open") === l ? "bg-indigo-100 dark:bg-indigo-950" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}
                  onClick={async () => {
                    const r = await setDatabaseLabelAction(dbId, l);
                    if (!r.ok) return void toast(r.error, { tone: "error" });
                    await p.reload();
                  }}
                >
                  {l === "open" ? t("Open") : l === "personal" ? t("Personal") : t("Secret")}
                </button>
              ))}
            </div>
            <MenuItem onClick={() => (close(), router.push("/privacy/boundaries"))}>🔒 {t("Data boundaries …")}</MenuItem>
          </MenuSection>

          <MenuSection title={t("View")}>
            <div className="px-2 py-1">
              <input className="input w-full text-sm" value={view.name} aria-label={t("View name")} onChange={(e) => setView({ ...view, name: e.target.value })} />
            </div>
            <p className="px-2 pt-1 text-xs text-zinc-500">{t("Show this view as — to keep it as it is, add another view with “+”")}</p>
            <div className="flex flex-wrap gap-1 px-2 pb-1">
              {PLAIN_VIEWS.map((vt) => (
                <button key={vt} type="button" className={`rounded px-1.5 py-0.5 text-sm ${view.type === vt ? "bg-indigo-100 dark:bg-indigo-950" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"}`} title={vt} aria-label={vt} aria-pressed={view.type === vt} onClick={() => setView({ ...view, type: vt, groupBy: vt === "board" && !view.groupBy ? schema.properties.find((x) => x.type === "status" || x.type === "select")?.id : view.groupBy, dateProp: vt === "calendar" && !view.dateProp ? schema.properties.find((x) => x.type === "date")?.id : view.dateProp })}>
                  {VIEW_ICON[vt]}
                </button>
              ))}
            </div>
            {narrow && (view.type === "board" || view.type === "gallery") && <MenuItem onClick={() => (close(), p.open("card"))}>🃏 {t("Card")}</MenuItem>}
            {/* Its sidebar beside the view or in the tree — an app's (its plugin brings it) or a template's <nav>; or (a template's) nowhere. */}
            {hasNav &&
              (
                [
                  ["workspace", `🧭 ${t("Navigation in the Workspace tree")}`],
                  ["view", `◧ ${t("Navigation beside the view")}`],
                  ...(/<nav[\s>]/.test(template) ? ([["off", `⊘ ${t("No navigation")}`]] as const) : []),
                ] as const
              ).map(([place, label]) => (
                <MenuItem
                  key={place}
                  checked={(view.nav ?? "view") === place}
                  onClick={() => {
                    close();
                    void setNavPlaceAction(dbId, view.id, place).then((r) => {
                      if (!r.ok) return toast(r.error, { tone: "error" });
                      void p.reload();
                      router.refresh();
                    });
                  }}
                >
                  {label}
                </MenuItem>
              ))}
            {/* The app's view as code: its template (written by hand or by the AI), drawn live. */}
            {view.type === "app" && appAvailable(data, view) && (
              <>
                <MenuItem checked={p.codeOpen} onClick={() => (close(), p.toggleCode())}>
                  &lt;/&gt; {t("Code")}
                </MenuItem>
                {view.template && <MenuItem onClick={() => (close(), confirmAction(t("Back to the default view? Your changes are gone.")) && p.resetTemplate())}>↺ {t("Reset to default")}</MenuItem>}
              </>
            )}
            {/* The rows hidden in the database: shown too (set back), or left out again. */}
            <MenuItem checked={!!view.showHidden} onClick={() => (close(), setView({ ...view, showHidden: !view.showHidden }))}>
              👁 {p.hiddenCount ? t("Show hidden rows ({n})", { n: p.hiddenCount }) : t("Show hidden rows")}
            </MenuItem>
            {view.groupBy && (view.type === "table" || view.type === "list") && (
              <MenuItem checked={!!view.hideEmpty} onClick={() => (close(), setView({ ...view, hideEmpty: !view.hideEmpty }))}>
                ▭ {t("Hide empty groups")}
              </MenuItem>
            )}
            {p.hasPerson && (
              <MenuItem checked={!!view.mine} onClick={() => (close(), setView({ ...view, mine: !view.mine }))}>
                {t("Only mine in this view")}
              </MenuItem>
            )}
            <MenuItem
              onClick={() => {
                close();
                const copy = { ...view, id: newId("v"), name: `${view.name} (${t("copy")})` };
                p.changeSchema((s) => ({ ...s, views: [...s.views, copy] }));
                p.pick(copy.id);
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
                p.changeSchema((s) => ({ ...s, views: rest }));
                p.pick(rest[0].id);
              }}
            >
              🗑 {t("Delete the view")}
            </MenuItem>
          </MenuSection>
        </>
      )}
    </Dropdown>
  );
}
