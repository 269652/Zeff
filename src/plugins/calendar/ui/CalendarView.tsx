"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@/components/I18nProvider";
import type { AppViewProps } from "@/plugins/workspace/ui/app-view";
import { CalendarApp } from "../CalendarApp";
import { calendarDataAction } from "../server-actions";
import type { CalendarData } from "../view-data";
import { isView, type ViewKind } from "../view-shared";

/**
 * The calendar as a view of the Workspace's calendar database: the whole calendar app (day, week, month, agenda, the appointments
 * todos propose, making and moving appointments) inside the database page. The view and the day are in the address (?v=&d=), so a
 * link or the back button goes where you were; what is shown is read from Zeff's calendar model, the rows of the database are
 * the same appointments for everything else the Workspace does with rows (filters, AI fields, pages).
 */
export default function CalendarView(_props: AppViewProps) {
  const t = useT();
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const view: ViewKind = isView(params.get("v")) ? (params.get("v") as ViewKind) : "week";
  const dayAsked = params.get("d") ?? params.get("w") ?? "";
  const [data, setData] = useState<CalendarData | null>(null);
  const [error, setError] = useState("");
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    const r = await calendarDataAction(view, dayAsked);
    if (mine !== seq.current) return;
    if (r.ok) {
      setData(r.data);
      setError("");
    } else setError(r.error);
  }, [view, dayAsked]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the appointments are read when the view or the day changes
    void load();
  }, [load]);

  const go = useCallback(
    (v: ViewKind, d: string) => {
      const q = new URLSearchParams(params.toString());
      q.set("v", v);
      q.set("d", d);
      router.replace(`${path}?${q}`, { scroll: false });
    },
    [params, path, router],
  );

  if (error && !data) return <p className="alert-error text-sm">{error}</p>;
  if (!data) return <p className="py-6 text-sm text-zinc-500">{t("Loading …")}</p>;
  return <CalendarApp key={data.view} view={data.view} day={data.day} explicitView={params.has("v")} calendars={data.calendars} events={data.events} proposed={data.proposed} now={data.now} canSync={data.canSync} onNavigate={go} onChanged={() => void load()} />;
}
