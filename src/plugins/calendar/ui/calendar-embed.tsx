"use client";

import { mergeAttributes, Node } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { useCallback, useEffect, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { dayOf, type CalendarView } from "@/lib/calendar/ir-shared";
import { GripBar } from "@/plugins/workspace/ui/app-nodes";
import { Dropdown } from "@/plugins/workspace/ui/kit";
import { useCalendarBody } from "../CalendarBody";
import { calendarDataAction } from "../server-actions";
import type { CalendarData } from "../view-data";
import { CALENDAR_CHANGED, stepDay, viewLabels, viewTitle, type ViewKind } from "../view-shared";

/**
 * A calendar as a block of a page: a day, a week or a month of a calendar — its main one (where what is made here goes) and
 * others shown beside it, each in its colour, with the proposals or without. All of it can be changed at any time in the
 * block's header (kept in the block); the day it shows starts at today.
 */

const EMBED_VIEWS: ViewKind[] = ["day", "week", "month"];
// (stable while nothing is read yet: new empty lists each render would reset the calendar's own state each time — a loop)
const NONE: never[] = [];

/** The ids of a comma list ("3,7"), without the main one and without repeats. */
const idsOf = (list: string, main: number) => [...new Set(list.split(",").map(Number))].filter((n) => n > 0 && n !== main);

const Swatch = ({ c }: { c: CalendarView }) => <span className="size-2.5 shrink-0 rounded-full" style={{ background: c.color }} aria-hidden />;

function CalendarEmbedView(p: NodeViewProps) {
  const t = useT();
  const calendarId = Number(p.node.attrs.calendarId) || 0;
  const view: ViewKind = EMBED_VIEWS.includes(p.node.attrs.view) ? p.node.attrs.view : "week";
  // (an old block has no such attribute: proposals shown)
  const proposals = p.node.attrs.proposals !== false && p.node.attrs.proposals !== "false";
  const [day, setDay] = useState(() => String(p.node.attrs.day || "") || dayOf(new Date()));
  const [data, setData] = useState<CalendarData | null>(null);
  const [error, setError] = useState("");
  // Other calendars shown beside the main one (kept in the block): whether what is planned here overlaps what is there.
  const alsoKey = idsOf(String(p.node.attrs.also ?? ""), calendarId).join(",");
  const load = useCallback(() => {
    // (asked for by id as well: one only this block shows is read all the same)
    void calendarDataAction(view, day, [calendarId, ...idsOf(alsoKey, 0)]).then((r) => (r.ok ? (setData(r.data), setError("")) : setError(r.error)));
  }, [view, day, calendarId, alsoKey]);
  useEffect(load, [load]);
  // Read again when appointments change from outside (a Think along card's proposals set up, regenerated or taken back).
  useEffect(() => {
    window.addEventListener(CALENDAR_CHANGED, load);
    return () => window.removeEventListener(CALENDAR_CHANGED, load);
  }, [load]);
  const calendars = data?.calendars ?? NONE;
  const calendar = calendars.find((c) => c.id === calendarId);
  const also = new Set(idsOf(alsoKey, 0));
  // (counted of those still there: a calendar gone since stays in the list, harmless, but isn't counted)
  const alsoShown = calendars.filter((c) => also.has(c.id)).length;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the set is made of alsoKey
  const shown = useCallback((c: { id: number }) => c.id === calendarId || also.has(c.id), [calendarId, alsoKey]);
  /** Another main calendar: what is made here goes there now (no longer listed beside itself). */
  const pickMain = (id: number) => p.updateAttributes({ calendarId: id, also: idsOf(alsoKey, id).join(",") });
  const toggleAlso = (id: number) => {
    if (id === calendarId) return;
    const next = new Set(also);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    p.updateAttributes({ also: [...next].join(",") });
  };
  const go = useCallback(
    (v: ViewKind, d: string) => {
      setDay(d);
      // The day it stands on is kept in the block: a page plans a certain month (a week, a day) — it opens there again.
      p.updateAttributes({ day: d, ...(v !== view && EMBED_VIEWS.includes(v) ? { view: v } : {}) });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- updateAttributes is the node view's, the same while it lives
    [view],
  );
  const { grid, overlays } = useCalendarBody({ view, day, calendars, events: data?.events ?? NONE, proposed: proposals ? (data?.proposed ?? NONE) : NONE, now: data?.now ?? `${day}T00:00`, shown, showProposed: proposals, go, onChanged: load, defaultCalendarId: calendarId || undefined, offerProposals: true });

  const row = "flex w-full cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-zinc-100 focus:bg-zinc-100 dark:hover:bg-zinc-800 dark:focus:bg-zinc-800";
  const heading = "px-1.5 pt-1 text-[11px] font-medium uppercase tracking-wide text-zinc-500";

  return (
    <NodeViewWrapper className="ws-app-block ws-module-block my-2" contentEditable={false} data-app-block="calendar">
      <GripBar editor={p.editor} node={p.node} getPos={p.getPos} deleteNode={p.deleteNode} label={t("Calendar")} />
      <section data-calendar-ui="" className="rounded-2xl border border-zinc-200/80 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        {!calendarId || (data && !calendar) ? (
          // Which calendar: none chosen yet, or the one it showed is gone.
          <div className="space-y-3 text-sm">
            <p className="font-medium">📅 {t("A calendar in this page")}</p>
            {!!calendarId && <p className="text-xs text-zinc-500">{t("The calendar this block showed is gone — pick another one.")}</p>}
            {calendars.length ? (
              <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t("Main calendar")}>
                <span className="text-xs text-zinc-500">{t("Show:")}</span>
                {calendars.map((c) => (
                  <button key={c.id} type="button" className="ws-tag inline-flex items-center gap-1" onClick={() => pickMain(c.id)}>
                    <Swatch c={c} />
                    {c.name}
                  </button>
                ))}
              </div>
            ) : (
              data && <p className="text-xs text-zinc-500">{t("No calendars yet — add one in the Kalender app.")}</p>
            )}
            {error && <p className="alert-error text-xs">{error}</p>}
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              {/* Which calendars: the main one (new appointments go there), those beside it, the proposals — at any time. */}
              <Dropdown
                label={
                  <span className="inline-flex items-center gap-1.5">
                    <span className="size-2.5 rounded-full" style={{ background: calendar?.color ?? "#7A869A" }} aria-hidden />
                    <span className="font-semibold">{calendar?.name ?? "…"}</span>
                    {alsoShown > 0 && <span className="text-zinc-500">+{alsoShown}</span>}
                    <span aria-hidden>▾</span>
                  </span>
                }
                ariaLabel={`${t("Calendars")}: ${calendar?.name ?? ""}${alsoShown ? ` +${alsoShown}` : ""}`}
                title={t("Which calendar this block shows, which beside it, and the proposals")}
                className="btn btn-sm"
              >
                {(close) => (
                  <div className="w-72 space-y-1 p-1 text-sm">
                    <p className={heading} id={`cal-main-${calendarId}`}>
                      {t("Main calendar — new appointments go here")}
                    </p>
                    <div role="group" aria-labelledby={`cal-main-${calendarId}`}>
                      {calendars.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          role="menuitemradio"
                          aria-checked={c.id === calendarId}
                          className={`${row} ${c.id === calendarId ? "bg-indigo-50 font-medium dark:bg-indigo-950/50" : ""}`}
                          onClick={() => {
                            if (c.id !== calendarId) pickMain(c.id);
                            close();
                          }}
                        >
                          <span className="w-3 text-center text-xs" aria-hidden>
                            {c.id === calendarId ? "●" : ""}
                          </span>
                          <Swatch c={c} />
                          <span className="min-w-0 flex-1 truncate">{c.name}</span>
                        </button>
                      ))}
                    </div>
                    <p className={`${heading} border-t border-zinc-100 pt-2 dark:border-zinc-800`} id={`cal-also-${calendarId}`}>
                      {t("Shown together")}
                    </p>
                    <div role="group" aria-labelledby={`cal-also-${calendarId}`}>
                      {calendars.map((c) => (
                        <label key={c.id} className={`${row} ${c.id === calendarId ? "cursor-default opacity-70" : ""}`} title={c.id === calendarId ? t("The main calendar is always shown") : undefined}>
                          <input type="checkbox" className="size-4" checked={c.id === calendarId || also.has(c.id)} disabled={c.id === calendarId} onChange={() => toggleAlso(c.id)} />
                          <Swatch c={c} />
                          <span className="min-w-0 flex-1 truncate">{c.name}</span>
                        </label>
                      ))}
                    </div>
                    <div className="border-t border-zinc-100 pt-1 dark:border-zinc-800">
                      <label className={row}>
                        <input type="checkbox" className="size-4" checked={proposals} onChange={() => p.updateAttributes({ proposals: !proposals })} />
                        <span className="min-w-0 flex-1">{t("Show proposals")}</span>
                      </label>
                    </div>
                  </div>
                )}
              </Dropdown>
              <span className="flex-1" />
              <button type="button" className="icon-btn" onClick={() => go(view, stepDay(view, day, -1))} aria-label={t("Previous")}>
                ‹
              </button>
              <button type="button" className="btn btn-sm" onClick={() => go(view, dayOf(new Date()))}>
                {t("Today")}
              </button>
              <button type="button" className="icon-btn" onClick={() => go(view, stepDay(view, day, 1))} aria-label={t("Next")}>
                ›
              </button>
              <span className="min-w-0 truncate text-sm text-zinc-500">{viewTitle(view, day)}</span>
              <span className="inline-flex overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700">
                {EMBED_VIEWS.map((v) => (
                  <button key={v} type="button" className={`px-2 py-0.5 text-xs ${v === view ? "bg-zinc-100 font-semibold dark:bg-zinc-800" : "text-zinc-500"}`} aria-pressed={v === view} onClick={() => go(v, day)}>
                    {viewLabels(t)[v]}
                  </button>
                ))}
              </span>
            </div>
            {error && <p className="alert-error text-xs">{error}</p>}
            {/* (as the app has it: a column of a fixed height, the grid filling it — it scrolls inside itself, to the working day) */}
            <div className={`flex flex-col overflow-hidden rounded-xl border border-zinc-100 dark:border-zinc-800 ${view === "month" ? "" : "h-[560px]"}`}>
              {data ? <section className="flex min-h-0 flex-1 flex-col overflow-hidden">{grid}</section> : <p className="p-4 text-sm text-zinc-500">{t("Loading …")}</p>}
            </div>
            {overlays}
          </div>
        )}
      </section>
    </NodeViewWrapper>
  );
}

/** A calendar embedded in a page (a day, a week or a month of a main calendar, others beside it). */
export const CalendarEmbedNode = Node.create({
  name: "calendarEmbed",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    // also: other calendars shown beside the main one, their ids ("3,7"); proposals: the proposed appointments shown too.
    return {
      calendarId: { default: 0 },
      view: { default: "week" },
      day: { default: "" },
      also: { default: "" },
      proposals: { default: true, parseHTML: (el: HTMLElement) => el.getAttribute("proposals") !== "false" },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-calendar-embed]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-calendar-embed": "" })];
  },
  addNodeView() {
    // (Clicks, keys and drags inside the calendar are its own — not the editor's: a click in the grid or the header no longer
    // selects the block, and a drag there moves an appointment, not the whole block. The grip bar stays the editor's.)
    return ReactNodeViewRenderer(CalendarEmbedView, { stopEvent: ({ event }) => !!(event.target instanceof Element && event.target.closest("[data-calendar-ui]")) });
  },
});
