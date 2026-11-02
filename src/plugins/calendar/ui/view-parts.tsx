"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { usePagePathname } from "@/lib/use-page-pathname";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import type { CalendarView } from "@/lib/calendar/ir-shared";
import type { AppViewProps, PartProps, ViewAppModule } from "@/plugins/workspace/ui/app-view";
import { calendarAppData } from "../app-data";
import { useCalendarBody } from "../CalendarBody";
import { MiniMonth } from "../MiniMonth";
import { calendarDataAction, syncCalendarsAction, updateCalendarAction } from "../server-actions";
import type { CalendarData } from "../view-data";
import { calendarItems, isView, itemOn, viewRange, ymd, type ViewKind } from "../view-shared";

/**
 * The calendar as a view of the Workspace's calendar database, client side: what its template reads as app.* (the appointments
 * around state.view and state.day, from Zeff's calendar model), and the parts it is built of where the language's tags aren't
 * enough — the grid itself, the month to pick a day from, a calendar's switch. The view and the day are in the address too (?v=&d=),
 * so a link (/kalender's) opens where it says.
 */

/** The appointments for the view and the day of the template's state, worked out for the template (app-data.ts). */
function useCalendarData(_props: AppViewProps, state: Record<string, string>) {
  const t = useT();
  const view: ViewKind = isView(state.view) ? state.view : "week";
  const day = state.day ?? "";
  const [d, setD] = useState<CalendarData | null>(null);
  const [error, setError] = useState("");
  const seq = useRef(0);
  // Only the latest load counts.
  const load = useCallback(async () => {
    const mine = ++seq.current;
    const r = await calendarDataAction(view, day);
    if (mine !== seq.current) return;
    if (r.ok) {
      setD(r.data);
      setError("");
    } else setError(r.error);
  }, [view, day]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the appointments are read when the view or the day changes
    void load();
  }, [load]);
  const [today] = useState(() => ymd(new Date()));
  const data = useMemo(() => calendarAppData(d, { state, t, today, error }), [d, state, t, today, error]);
  return { data, reload: () => void load() };
}

const dataOf = (p: PartProps) => (p.app.data as CalendarData | null | undefined) ?? null;
/** A calendar shown: as switched here (state.cal<id>), else as it is stored. */
const shownIn = (state: Record<string, string>, c: CalendarView) => (state[`cal${c.id}`] === "1" ? true : state[`cal${c.id}`] === "0" ? false : c.visible);

/** The view and the day from the address once (else a narrow screen opens on the day view), and back into it as they change. */
function useAddress(state: Record<string, string>, setState: (name: string, value: string) => void) {
  const router = useRouter();
  const path = usePagePathname();
  const params = useSearchParams();
  // What the view opened with (the address' or the state's): from then on a change goes into the address.
  const opened = useRef<string | null>(null);
  const key = `${state.view}|${state.day ?? ""}`;
  useEffect(() => {
    if (opened.current === null) {
      const v = params.get("v");
      const d = params.get("d") ?? params.get("w");
      const view = isView(v) ? v : window.innerWidth < 640 ? "day" : state.view;
      const day = d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : (state.day ?? "");
      opened.current = `${view}|${day}`;
      if (view !== state.view) setState("view", view);
      if (day !== (state.day ?? "")) setState("day", day);
      return;
    }
    // Replaced, not pushed: the back button leaves the calendar, as before.
    if (opened.current === key) return;
    opened.current = "";
    if (params.get("v") === state.view && (params.get("d") ?? "") === (state.day ?? "")) return;
    const q = new URLSearchParams(params.toString());
    q.set("v", state.view);
    if (state.day) q.set("d", state.day);
    else q.delete("d");
    q.delete("w");
    router.replace(`${path}?${q}`, { scroll: false });
  }, [key, state.view, state.day, params, path, router, setState]);
}

const FRAME = "flex h-[calc(100dvh-10rem)] min-h-[32rem] min-w-0 flex-[1_1_32rem] flex-col";

/**
 * The frame as high as the room left below it — down to the bottom of what scrolls (the page, or the pane it sits in) — so only
 * the time grid scrolls, not the page around it too (what sits above it differs: the Workspace's title, tabs and toolbar).
 */
function useFill(): [React.RefObject<HTMLDivElement | null>, number | null] {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let pane: HTMLElement | null = el.parentElement;
    while (pane && !/(auto|scroll)/.test(getComputedStyle(pane).overflowY)) pane = pane.parentElement;
    const measure = () => {
      const top = el.getBoundingClientRect().top;
      const offset = pane ? top - pane.getBoundingClientRect().top + pane.scrollTop : top + window.scrollY;
      const room = pane ? pane.clientHeight : window.innerHeight;
      setHeight(Math.max(512, Math.floor(room - offset - 16)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(document.documentElement);
    if (pane) ro.observe(pane);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  return [ref, height];
}

/** The calendar itself, beside the sidebar (the room left in its row): day, week, month or agenda of state.view and state.day. */
function GridPart(p: PartProps) {
  const t = useT();
  useAddress(p.state, p.setState);
  const d = dataOf(p);
  if (!d) return <div className={FRAME}>{p.app.error ? <p className="alert-error text-sm">{String(p.app.error)}</p> : <p className="py-6 text-sm text-zinc-500">{t("Loading …")}</p>}</div>;
  return <Grid key={d.view} {...p} d={d} />;
}

function Grid({ d, state, setState, reloadApp, onNew }: PartProps & { d: CalendarData }) {
  const go = useCallback(
    (v: ViewKind, day: string) => {
      setState("view", v);
      setState("day", day);
    },
    [setState],
  );
  const shown = useCallback((c: CalendarView) => shownIn(state, c), [state]);
  const { pending, newNow, grid, overlays } = useCalendarBody({ view: d.view, day: d.day, calendars: d.calendars, events: d.events, proposed: d.proposed, now: d.now, shown, showProposed: state.proposed !== "", go, onChanged: reloadApp });

  // New — the toolbar's, and the sidebar's button (state.new, a new value each click): a new appointment in the next half hour.
  useEffect(() => {
    onNew?.(newNow);
    return () => onNew?.(null);
  }, [onNew, newNow]);
  const asked = state.new ?? "";
  const seen = useRef(asked);
  useEffect(() => {
    if (!asked || asked === seen.current) return;
    seen.current = asked;
    newNow();
  }, [asked, newNow]);

  // "Saving…" in the toolbar (the template's) while a change is saved — set as it starts and ends (Sync sets it too).
  const was = useRef(pending);
  useEffect(() => {
    if (was.current === pending) return;
    was.current = pending;
    setState("saving", pending ? "true" : "");
  }, [pending, setState]);

  const [frame, height] = useFill();
  return (
    <div ref={frame} className={FRAME} style={height ? { height } : undefined}>
      <section className="card min-h-0 flex-1 overflow-hidden">{grid}</section>
      {overlays}
    </div>
  );
}

/** The month to pick a day from — as wide as the sidebar is. */
function MiniMonthPart(p: PartProps) {
  const d = dataOf(p);
  const view = (p.app.view as ViewKind) ?? "week";
  const day = String(p.app.day ?? p.app.today ?? "");
  const today = String(p.app.today ?? "");
  const days = useMemo(() => viewRange(view, day).days, [view, day]);
  const busyDays = useMemo(() => {
    if (!d) return new Set<string>();
    const items = calendarItems(d.events, d.proposed, d.calendars, (c) => shownIn(p.state, c), p.state.proposed !== "");
    return new Set(days.filter((x) => items.some((it) => itemOn(it, x))));
  }, [d, days, p.state]);
  const go = (x: string) => {
    if (view === "month" || view === "agenda") p.setState("view", "day");
    p.setState("day", x);
  };
  if (!day) return null;
  return (
    <div className="w-72 max-w-full">
      <MiniMonth focus={day} shown={view === "month" ? days.filter((x) => x.slice(0, 7) === day.slice(0, 7)) : days} today={today} busyDays={busyDays} onPick={go} />
    </div>
  );
}

/** A calendar's switch in its colour (saved — it stays so), or the todos' proposals' (the view's state). */
function TogglePart(p: PartProps) {
  const d = dataOf(p);
  const id = p.attrs.calendar;
  const c = id === "proposed" ? null : (d?.calendars.find((x) => String(x.id) === id) ?? null);
  if (id !== "proposed" && !c) return null;
  const checked = c ? shownIn(p.state, c) : p.state.proposed !== "";
  const flip = () => {
    if (!c) return p.setState("proposed", checked ? "" : "true");
    p.setState(`cal${c.id}`, checked ? "0" : "1");
    void updateCalendarAction(c.id, { visible: !checked }).then((r) => {
      if (r?.ok) return;
      toast(r?.error ?? "", { tone: "error" });
      p.reloadApp();
    });
  };
  return (
    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800">
      <input type="checkbox" className="size-4 rounded" style={{ accentColor: c?.color ?? "#6366F1" }} checked={checked} onChange={flip} />
      <span className="min-w-0 flex-1 truncate">{p.attrs.label}</span>
    </label>
  );
}

const view: ViewAppModule = {
  parts: { "calendar.grid": GridPart, "calendar.minimonth": MiniMonthPart, "calendar.toggle": TogglePart },
  useAppData: useCalendarData,
  actions: {
    "calendar.new": (env) => env.setState("new", String(Date.now())),
    "calendar.sync": (env) => {
      env.setState("saving", "true");
      // (The days shown are read too — a month gone by.)
      const day = /^\d{4}-\d{2}-\d{2}$/.test(env.state.day ?? "") ? env.state.day : ymd(new Date());
      void syncCalendarsAction(viewRange(isView(env.state.view) ? env.state.view : "week", day)).then(
        (r) => {
          env.setState("saving", "");
          toast(r?.ok ? (r.message ?? "") : (r?.error ?? ""), { tone: r?.ok ? "ok" : "error" });
          env.reloadApp();
        },
        (e: unknown) => {
          env.setState("saving", "");
          toast(e instanceof Error ? e.message : String(e), { tone: "error" });
        },
      );
    },
  },
};
export default view;
