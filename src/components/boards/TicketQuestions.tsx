"use client";

import type { TicketQuestion } from "@/lib/runs/shared";
import { useT } from "../I18nProvider";

/** A ticket's possible questions with their answers (from the context, or looked up in the knowledge base). */
export function TicketQuestions({ questions }: { questions: TicketQuestion[] }) {
  const t = useT();
  if (!questions.length) return null;
  return (
    <section>
      <h3 className="label">{t("Possible questions")}</h3>
      <dl className="space-y-1.5 text-xs">
        {questions.map((x, i) => (
          <div key={i}>
            <dt className="font-medium">{x.q}</dt>
            <dd className={x.a ? "text-zinc-700 dark:text-zinc-300" : "text-zinc-400"}>
              {x.a ?? t("No answer found")}
              {x.sources?.length ? <span className="text-zinc-500" title={t("Answered from the knowledge base")}> · {x.sources.join(", ")}</span> : null}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
