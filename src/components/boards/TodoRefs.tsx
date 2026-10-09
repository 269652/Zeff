import { Fragment, type ReactNode } from "react";

const TODO_REF = /(?<![\w-])(T-\d+)\b/g;

/** "T-37" in a text as links to that todo (on the Boards tab, wherever it is); `rest` renders what's between. */
export function TodoRefs({ text, rest = (s) => s, className = "font-mono text-indigo-600 hover:underline dark:text-indigo-400" }: { text: string; rest?: (s: string) => ReactNode; className?: string }) {
  const parts = text.split(TODO_REF);
  if (parts.length === 1) return <>{rest(text)}</>;
  return parts.map((p, i) =>
    i % 2 ? (
      <a key={i} href={`/t/${p.slice(2)}`} className={className} title={`${p} zeigen`}>
        {p}
      </a>
    ) : (
      <Fragment key={i}>{rest(p)}</Fragment>
    ),
  );
}
