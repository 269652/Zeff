"use client";

import { mergeAttributes, Node } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { useCallback, useEffect, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { dayOf } from "@/lib/calendar/ir-shared";
import { GripBar } from "@/plugins/workspace/ui/app-nodes";
import { Dropdown } from "@/plugins/workspace/ui/kit";
import { useCalendarBody } from "../CalendarBody";
import { calendarDataAction, createShadowCalendarAction } from "../server-actions";
import type { CalendarData } from "../view-data";
import { stepDay, viewLabels, viewTitle, type ViewKind } from "../view-shared";

/**
 * A calendar as a block of a page: a day, a week or a month of one calendar — usually a shadow calendar made for the page (a plan:
 * the week of a trip, a sprint, a routine), whose appointments show in the main calendar as suggestions to accept or dismiss.
 * Made, moved and resized here as in the Kalender app; new ones go into this calendar. Its view and calendar are kept in the
 * block; the day it shows starts at today.
 */

const EMBED_VIEWS: ViewKind[] = ["day", "week", "month"];
// (stable while nothing is read yet: new empty lists each render would reset the calendar's own state each time — a loop)
const NONE: never[] = [];

function CalendarEmbedView(p: NodeViewProps) {
  const t = useT();
  const calendarId = Number(p.node.attrs.calendarId) || 0;
  const view: ViewKind = EMBED_VIEWS.includes(p.node.attrs.view) ? p.node.attrs.view : "week";
  const [day, setDay] = useState(() => String(p.node.attrs.day || "") || dayOf(new Date()));
  const [data, setData] = useState<CalendarData | null>(null);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  // (Its own calendar and those beside it asked for by id: a plan just made, its page not saved yet, is still there.)
  const alsoIds = String(p.node.attrs.also ?? "");
  const load = useCallback(() => {
    void calendarDataAction(view, day, [calendarId, ...alsoIds.split(",").map(Number)]).then((r) => (r.ok ? (setData(r.data), setError("")) : setError(r.error)));
  }, [view, day, calendarId, alsoIds]);
  useEffect(load, [load]);
  const calendar = data?.calendars.find((c) => c.id === calendarId);
  // Other calendars shown beside it (kept in the block): whether what is planned here overlaps what is there.
  const alsoKey = String(p.node.attrs.also ?? "");
  const also = new Set(alsoKey.split(",").map(Number).filter((n) => n > 0));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the set is made of alsoKey
  const shown = useCallback((c: { id: number }) => c.id === calendarId || also.has(c.id), [calendarId, alsoKey]);
  const toggleAlso = (id: number) => {
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
  const { grid, overlays } = useCalendarBody({ view, day, calendars: data?.calendars ?? NONE, events: data?.events ?? NONE, proposed: NONE, now: data?.now ?? `${day}T00:00`, shown, showProposed: false, go, onChanged: load, shadowAsProposal: false, defaultCalendarId: calendarId || undefined });

  const makeShadow = async () => {
    const r = await createShadowCalendarAction(name.trim() || t("Shadow calendar"));
    if (!r.ok) return void toast(r.error, { tone: "error" });
    p.updateAttributes({ calendarId: r.id });
    load();
  };

  return (
    <NodeViewWrapper className="ws-app-block ws-module-block my-2" contentEditable={false} data-app-block="calendar">
      <GripBar editor={p.editor} node={p.node} getPos={p.getPos} deleteNode={p.deleteNode} label="calendar" />
      <section className="rounded-2xl border border-zinc-200/80 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        {!calendarId || (data && !calendar) ? (
          // Which calendar: a new shadow calendar (its appointments suggestions in the main one), or one there is.
          <div className="space-y-3 text-sm">
            <p className="font-medium">📅 {t("A calendar in this page")}</p>
            <p className="text-xs text-zinc-500">{t("A shadow calendar is a plan: what you put in it shows in your main calendar as suggestions — accept them into it, or dismiss them. It blocks no time until then.")}</p>
            <div className="flex flex-wrap items-center gap-2">
              <input className="input w-56 py-1 text-sm" value={name} placeholder={t("Shadow calendar")} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void makeShadow()} aria-label={t("Its name")} />
              <button type="button" className="btn btn-primary btn-sm" onClick={() => void makeShadow()}>
                {t("New shadow calendar")}
              </button>
            </div>
            {!!data?.calendars.length && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-zinc-500">{t("or show one there is:")}</span>
                {data.calendars.map((c) => (
                  <button key={c.id} type="button" className="ws-tag" onClick={() => p.updateAttributes({ calendarId: c.id })}>
                    <span className="mr-1 inline-block size-2 rounded-full" style={{ background: c.color }} />
                    {c.name}
                    {c.shadow ? ` · ${t("shadow")}` : ""}
                  </button>
                ))}
              </div>
            )}
            {error && <p className="alert-error text-xs">{error}</p>}
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="size-2.5 rounded-full" style={{ background: calendar?.color ?? "#7A869A" }} />
              <span className="text-sm font-semibold">{calendar?.name ?? "…"}</span>
              {calendar?.shadow && (
                <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300" title={t("Its appointments show in your main calendar as suggestions")}>
                  {t("Shadow calendar")}
                </span>
              )}
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
              {/* The other calendars, on or off beside this one — to see whether the plan overlaps them. */}
              {!!data && data.calendars.length > 1 && (
                <Dropdown label={`${t("Calendars")}${also.size ? ` +${also.size}` : ""} ▾`} align="right" title={t("Show other calendars beside it — to see what overlaps")} className="btn btn-sm">
                  {() => (
                    <div className="w-64 space-y-0.5 p-1 text-sm">
                      {data.calendars
                        .filter((c) => c.id !== calendarId)
                        .map((c) => (
                          <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                            <input type="checkbox" className="size-4" checked={also.has(c.id)} onChange={() => toggleAlso(c.id)} />
                            <span className="size-2.5 shrink-0 rounded-full" style={{ background: c.color }} />
                            <span className="min-w-0 flex-1 truncate">{c.name}</span>
                            {c.shadow && <span className="text-[11px] text-zinc-400">{t("shadow")}</span>}
                          </label>
                        ))}
                    </div>
                  )}
                </Dropdown>
              )}
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

/** A calendar embedded in a page (a day, a week or a month of one calendar — a shadow calendar's for a plan). */
export const CalendarEmbedNode = Node.create({
  name: "calendarEmbed",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    // also: other calendars shown beside it, their ids ("3,7").
    return { calendarId: { default: 0 }, view: { default: "week" }, day: { default: "" }, also: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "div[data-calendar-embed]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-calendar-embed": "" })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(CalendarEmbedView);
  },
});
