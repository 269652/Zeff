import { aggregateRoarKind, roarStatusTitle, type EntryRoarStatus, type RoarMarkKind } from "@/lib/roar-status";

const MARK_CLASS: Record<RoarMarkKind, string> = {
  approved: "text-emerald-600 dark:text-emerald-400",
  rejected: "text-red-600 dark:text-red-400",
  submitted: "text-amber-500 dark:text-amber-400",
  draft: "text-zinc-400",
  missing: "text-zinc-300 dark:text-zinc-600",
};

/** Approved hours read green (with the ✓ mark next to them). */
export const ROAR_APPROVED_TEXT = "text-emerald-600 dark:text-emerald-400";

/** approved ✓, rejected ✕, submitted (clock), draft (dot), missing (dashed ring) — 14 px. */
function MarkIcon({ kind }: { kind: RoarMarkKind }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`inline-block size-3.5 ${MARK_CLASS[kind]}`}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" strokeDasharray={kind === "missing" ? "3 3" : undefined} />
      {kind === "approved" && <path d="M8.5 12.5l2.5 2.5 4.5-5" />}
      {kind === "rejected" && <path d="M9 9l6 6M15 9l-6 6" />}
      {kind === "submitted" && <path d="M12 7.5V12l3 2" />}
      {kind === "draft" && <circle cx="12" cy="12" r="1.5" fill="currentColor" />}
    </svg>
  );
}

function Mark({ kind, title }: { kind: RoarMarkKind; title: string }) {
  return (
    <span className="ml-1 inline-flex align-[-2px]" title={title} aria-label={title}>
      <MarkIcon kind={kind} />
    </span>
  );
}

/** One entry's Roar status (or "not in Roar" when the week was pulled but nothing matched). */
export function RoarMark({ status }: { status: EntryRoarStatus | undefined }) {
  return <Mark kind={status ? status.kind : "missing"} title={status ? roarStatusTitle(status) : "Not in Roar"} />;
}

/** Several entries' Roar statuses as one mark (a weekly-table cell). */
export function RoarCellMark({ statuses }: { statuses: (EntryRoarStatus | undefined)[] }) {
  const kind = aggregateRoarKind(statuses);
  if (!kind) return null;
  const known = statuses.filter((s): s is EntryRoarStatus => !!s);
  const title =
    kind === "missing"
      ? `${statuses.length - known.length} of ${statuses.length} not in Roar`
      : kind === "approved"
        ? `Roar: approved${known[0]?.approvedBy ? ` by ${known[0].approvedBy}` : ""}`
        : roarStatusTitle(known.find((s) => s.kind === kind)!);
  return <Mark kind={kind} title={title} />;
}
