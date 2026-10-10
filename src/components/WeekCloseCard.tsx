import Link from "next/link";
import type { CloseState, WeekClose } from "@/lib/week-close";

const MARK: Record<CloseState, { icon: string; className: string; title: string }> = {
  ok: { icon: "✓", className: "text-emerald-600 dark:text-emerald-400", title: "done" },
  open: { icon: "•", className: "text-red-600 dark:text-red-400", title: "open" },
  unknown: { icon: "?", className: "text-amber-600 dark:text-amber-400", title: "not known — fetch it first" },
  later: { icon: "…", className: "text-zinc-400", title: "not due yet — the week is still running" },
};

/** Wochenabschluss: the week's closing steps, each done or not, with where to do what's left. */
export function WeekCloseCard({ close, week }: { close: WeekClose; week: number }) {
  const done = close.items.filter((i) => i.state === "ok").length;
  return (
    <section className="card p-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-zinc-500 uppercase">Week close · W{week}</h2>
        <span className={`text-sm ${close.done ? "font-medium text-emerald-600 dark:text-emerald-400" : close.over ? "text-red-600 dark:text-red-400" : "text-zinc-500"}`}>
          {close.done ? "✓ Week closed" : `${done} of ${close.items.length} done`}
        </span>
      </div>
      <ul className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        {close.items.map((i) => (
          <li key={i.key} className="flex min-w-0 items-baseline gap-2">
            <span className={`w-3 shrink-0 text-center font-semibold ${MARK[i.state].className}`} title={MARK[i.state].title}>
              {MARK[i.state].icon}
            </span>
            {i.state === "ok" || i.state === "later" ? (
              <span className="shrink-0">{i.label}</span>
            ) : (
              <Link href={i.href} className="shrink-0 hover:underline">
                {i.label}
              </Link>
            )}
            <span className="min-w-0 truncate text-xs text-zinc-500" title={i.detail}>
              {i.detail}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
