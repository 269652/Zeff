"use client";

import { Fragment, type ReactNode } from "react";
import { useT } from "@/components/I18nProvider";

const TODO_REF = /(?<![\w-])(T-\d+)\b/g;

/**
 * "T-37" in a text as links to that todo (on the Todos tab, wherever it is); `rest` renders what's between.
 * A client component (its link title follows the language); server pages pass only `text`.
 */
export function TodoRefs({ text, rest = (s) => s, className = "font-mono text-indigo-600 hover:underline dark:text-indigo-400" }: { text: string; rest?: (s: string) => ReactNode; className?: string }) {
  const t = useT();
  const parts = text.split(TODO_REF);
  if (parts.length === 1) return <>{rest(text)}</>;
  return parts.map((p, i) =>
    i % 2 ? (
      <a key={i} href={`/t/${p.slice(2)}`} className={className} title={t("Show {ref}", { ref: p })}>
        {p}
      </a>
    ) : (
      <Fragment key={i}>{rest(p)}</Fragment>
    ),
  );
}
