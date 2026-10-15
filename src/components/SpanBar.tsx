import { collectCandidates } from "@/lib/entry-parallel";
import type { EntrySpan } from "@/lib/entry-spans";
import { stretchOf } from "@/lib/entry-timeline";
import { formatHours } from "@/lib/format";
import { t } from "@/lib/i18n/server";
import { listPausesByDate } from "@/lib/pauses";
import { CollectGroupButton } from "./EntryGroupSwitch";

type Row = { id: number; hours: number; workedHours: number | null; start: string | null };

const labels = (): Record<EntrySpan["mode"], string> => ({
  collect: t("Collecting entry"),
  combine: t("Combined parallel work"),
  divide: t("Divided parallel work"),
  sequential: t("Parallel work, one after the other"),
  remainder: t("Collecting entry"),
});

/**
 * The bar of a group of parallel work (above its entries, in the weekly report and on an entry's
 * page): how it is booked, the stretch it spans, what the tasks worked against what the group books.
 * How it books is chosen in the group menu (the group mark of an entry), not here. The tasks stay as they are.
 */
export function SpanBar({ span, head, members }: { span: EntrySpan; head: Row | null; members: Row[] }) {
  const worked = members.reduce((s, m) => s + (m.workedHours ?? m.hours), 0);
  // (what the group's entry and its tasks book — all stored as booked hours)
  const booked = (head?.hours ?? 0) + members.reduce((s, m) => s + m.hours, 0);
  const stretch = stretchOf(members.map((m) => ({ start: m.start, hours: m.workedHours ?? m.hours })), listPausesByDate(span.date, span.date)[span.date] ?? []);
  const collecting = span.mode === "collect" && !span.headAuto;
  const candidates = collecting && head ? collectCandidates(head.id).length : 0;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
      <span className="font-medium text-indigo-700 dark:text-indigo-300">{labels()[span.mode]}</span>
      {stretch.from && stretch.to && (
        <span className="font-mono text-zinc-500">
          {stretch.from}–{stretch.to}
        </span>
      )}
      <span className="text-zinc-500">{t("Books {booked} h · the tasks worked {worked} h", { booked: formatHours(booked), worked: formatHours(worked) })}</span>
      {head && candidates > 0 && (
        <span className="ml-auto">
          <CollectGroupButton headId={head.id} count={candidates} />
        </span>
      )}
    </div>
  );
}
