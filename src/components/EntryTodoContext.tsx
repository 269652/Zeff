"use client";

import Link from "next/link";
import type { EntryTodoContext } from "@/lib/entry-todo-context";
import { ContextList, TodoSources, useContextItems } from "./boards/TodoSources";

const todoRef = (id: number) => `T-${id}`;

/** In the entries table: the todos' context behind its toggle ("Show context (N)", hover for the newest). */
export function EntryTodoContextToggle({ ctx }: { ctx: EntryTodoContext }) {
  return <TodoSources list={ctx.sources} notes={ctx.notes} />;
}

/**
 * On the entry's page: the todos and runs that flowed into it, and their context — what they came
 * from (Jira, Teams, mails, GitLab), their notes and AI reports — as the todos show it, read now.
 */
export function EntryTodoContextSection({ ctx }: { ctx: EntryTodoContext }) {
  const { items } = useContextItems(ctx.sources, ctx.notes);
  return (
    <section className="card space-y-3 p-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-sm font-semibold text-zinc-500 uppercase">
          Aus den Todos <span className="font-normal normal-case text-zinc-400">({items.length})</span>
        </h2>
        <span className="flex flex-wrap gap-x-2 gap-y-1 text-xs">
          {ctx.todos.map((t) => (
            <Link key={t.id} href={`/t/${t.id}`} className="font-mono text-indigo-600 hover:underline dark:text-indigo-400" title={t.text}>
              {todoRef(t.id)}
            </Link>
          ))}
          {ctx.runs.map((r) => (
            <Link key={r} href="/work" className="font-mono text-violet-700 hover:underline dark:text-violet-300" title={`Work-Lauf W-${r}`}>
              W-{r}
            </Link>
          ))}
        </span>
      </div>
      {items.length ? <ContextList items={items} /> : <p className="text-sm text-zinc-500">Die Todos bringen keinen Kontext mit.</p>}
    </section>
  );
}
