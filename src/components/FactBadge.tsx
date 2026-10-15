import type { FactView } from "@/lib/facts-shared";
import { SourceCard } from "./SourceCard";
import { formatDate } from "@/lib/format";
import { useT } from "@/components/I18nProvider";

/** A fact as a small card: its subject and what is true — with `onToggle` it unfolds. */
export function FactBadge({ f, className = "", expanded = false, onToggle }: { f: FactView; className?: string; expanded?: boolean; onToggle?: () => void }) {
  const t = useT();
  return (
    <SourceCard
      tone="teal"
      icon={<span className="text-base leading-none">💡</span>}
      kind={t("Fact")}
      when={formatDate(f.updatedAt, { weekday: false })}
      title={f.text || f.subject}
      sub={f.subject}
      expanded={expanded}
      onToggle={onToggle}
      toggleTitle={expanded ? t("Fold") : t("Show the fact")}
      className={className}
    />
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
