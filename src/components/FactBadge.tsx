import type { FactView } from "@/lib/facts-shared";
import { ChevronIcon } from "./icons";
import { formatDate } from "@/lib/format";
import { useT } from "@/components/I18nProvider";

const BADGE = "flex min-w-0 items-stretch overflow-hidden rounded-md border border-amber-200 bg-amber-50 text-xs text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100";
const INNER = "flex min-w-0 flex-1 items-center gap-2 py-1 pr-2 pl-1.5 text-left";

/** A fact as a badge: "💡 Nadines Geburtstag: 16.10." — with `onToggle` it unfolds. */
export function FactBadge({ f, className = "", expanded = false, onToggle }: { f: FactView; className?: string; expanded?: boolean; onToggle?: () => void }) {
  const t = useT();
  const body = (
    <>
      {onToggle && <ChevronIcon open={expanded} className="size-3.5 shrink-0 text-amber-500" />}
      <span aria-hidden>💡</span>
      <span className="shrink-0 font-medium">{f.subject}</span>
      <span className="min-w-0 truncate">{f.text}</span>
    </>
  );
  return (
    <div className={`${BADGE} ${className}`}>
      {onToggle ? (
        <button type="button" className={`${INNER} cursor-pointer transition hover:bg-amber-100 dark:hover:bg-amber-950`} onClick={onToggle} aria-expanded={expanded} title={expanded ? t("Fold") : t("Show the fact")}>
          {body}
        </button>
      ) : (
        <span className={INNER}>{body}</span>
      )}
    </div>
  );
}

/** A fact in full: what's true, since when, from where (the messages it was found in). */
export function FactDetails({ f }: { f: FactView }) {
  const t = useT();
  return (
    <div className="space-y-1 rounded-lg border border-zinc-200 bg-white p-3 text-sm shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-xs text-zinc-500">
        {t("Fact · last {date}", { date: formatDate(f.updatedAt, { weekday: false, year: true }) })}
      </p>
      <p>
        <span className="font-medium">{f.subject}:</span> {f.text}
      </p>
      <p className="text-xs text-zinc-400">
        {f.refs.length === 1
          ? t("Found in 1 message — goes into Knowledge.")
          : t("Found in {n} messages — goes into Knowledge.", { n: f.refs.length })}
      </p>
    </div>
  );
}
