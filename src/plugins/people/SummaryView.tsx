import { formatAgo } from "@/lib/format";
import { t } from "@/lib/i18n/server";
import type { PersonSummary } from "./shared";

/** The first sentence of what connects you — what the closed summary shows. */
export const summaryTeaser = (s: PersonSummary) => {
  const first = (s.connection || s.keyFacts[0] || s.funFacts[0] || "").trim();
  const cut = /^(.{20,160}?[.!?])(\s|$)/.exec(first)?.[1];
  return cut ?? (first.length > 160 ? `${first.slice(0, 159)}…` : first);
};

/** A person's compiled summary, folded: its first sentence shows, the rest (what connects you, key facts, fun facts) opens. */
export function PersonSummaryDetails({ summary, open = false }: { summary: PersonSummary; open?: boolean }) {
  return (
    <details open={open} className="group rounded-md border border-zinc-200 bg-zinc-50/60 p-2 text-sm dark:border-zinc-800 dark:bg-zinc-900/40">
      <summary className="cursor-pointer list-none text-zinc-600 marker:hidden dark:text-zinc-300 [&::-webkit-details-marker]:hidden">
        <span className="mr-1 inline-block text-zinc-400 transition group-open:rotate-90" aria-hidden>▸</span>
        <span className="font-medium">{t("Summary")}</span>
        <span className="ml-2 text-zinc-500 group-open:hidden">{summaryTeaser(summary)}</span>
      </summary>
      <div className="mt-2 space-y-2">
        {summary.connection && (
          <section>
            <h3 className="label">{t("What connects you")}</h3>
            <p className="whitespace-pre-line text-zinc-700 dark:text-zinc-300">{summary.connection}</p>
          </section>
        )}
        {summary.keyFacts.length > 0 && (
          <section>
            <h3 className="label">{t("Key facts")}</h3>
            <ul className="list-disc space-y-0.5 pl-4 text-zinc-700 dark:text-zinc-300">
              {summary.keyFacts.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          </section>
        )}
        {summary.funFacts.length > 0 && (
          <section>
            <h3 className="label">{t("Fun facts")}</h3>
            <ul className="space-y-0.5 text-zinc-700 dark:text-zinc-300">
              {summary.funFacts.map((f, i) => (
                <li key={i}>🎈 {f}</li>
              ))}
            </ul>
          </section>
        )}
        <p className="text-xs text-zinc-400">{t("Compiled {ago} from {n} things", { ago: formatAgo(Date.parse(summary.at)), n: summary.sources })}</p>
      </div>
    </details>
  );
}
