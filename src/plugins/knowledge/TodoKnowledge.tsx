"use client";

import { useEffect, useState } from "react";
import { todoKnowledgeAction } from "@/plugins/knowledge/server-actions";
import { snippetParts, type KnowledgeEntity, type KnowledgePage } from "./shared";

type Loaded = { pages: KnowledgePage[]; entities: KnowledgeEntity[] } | { error: string } | null;

const cache = new Map<number, Loaded>();

/** A todo's knowledge (the Confluence pages and entities that fit it), read when first shown — kept while the page is open. */
export function useTodoKnowledge(todoId: number, wanted: boolean): Loaded {
  const [got, setGot] = useState<Loaded>(() => cache.get(todoId) ?? null);
  useEffect(() => {
    if (!wanted || got) return;
    let live = true;
    void todoKnowledgeAction(todoId).then((r) => {
      const v: Loaded = r.ok ? { pages: r.pages, entities: r.entities } : { error: r.error };
      cache.set(todoId, v);
      if (live) setGot(v);
    });
    return () => {
      live = false;
    };
  }, [todoId, wanted, got]);
  return got;
}

/** The pages (title, space, the passage found) and the entities with their relations. */
export function TodoKnowledgeList({ k }: { k: Loaded }) {
  if (!k) return <p className="text-xs text-zinc-500">Sucht im Wissen …</p>;
  if ("error" in k) return <p className="text-xs text-red-600 dark:text-red-400">{k.error}</p>;
  if (!k.pages.length && !k.entities.length) return <p className="text-xs text-zinc-500">Nichts Passendes im Wissen.</p>;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {k.pages.map((p) => (
        <div key={p.id} className="min-w-0 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs dark:border-emerald-900 dark:bg-emerald-950/40">
          <div className="flex min-w-0 items-baseline gap-2">
            {p.url ? (
              <a href={p.url} target="_blank" rel="noreferrer" className="truncate font-medium text-emerald-900 hover:underline dark:text-emerald-100">
                {p.title}
              </a>
            ) : (
              <span className="truncate font-medium text-emerald-900 dark:text-emerald-100">{p.title}</span>
            )}
            <span className="shrink-0 text-emerald-700/80 dark:text-emerald-300/80">{p.space}</span>
          </div>
          <p className="line-clamp-2 text-emerald-900/70 dark:text-emerald-100/70">
            {snippetParts(p.snippet).map((x, i) => (x.mark ? <mark key={i} className="rounded-sm bg-amber-200 px-0.5 text-inherit dark:bg-amber-700/60">{x.text}</mark> : <span key={i}>{x.text}</span>))}
          </p>
        </div>
      ))}
      {k.entities.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {k.entities.map((e) => (
            <span key={e.id} className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300" title={[e.summary, ...e.related.map((r) => (r.dir === "out" ? `→ ${r.rel} ${r.name}` : `← ${r.name} ${r.rel}`))].join("\n")}>
              {e.name} <span className="text-zinc-400">{e.type}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** The toggle's hovercard: the knowledge the Wissens-Zuordnung picked. */
export function TodoKnowledgePreview({ k }: { k: Loaded }) {
  return (
    <div className="space-y-1.5 overflow-hidden rounded-lg border border-zinc-200 bg-white p-3 text-xs shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <p className="font-medium text-zinc-600 dark:text-zinc-300">Wissen (Confluence)</p>
      <TodoKnowledgeList k={k} />
    </div>
  );
}
