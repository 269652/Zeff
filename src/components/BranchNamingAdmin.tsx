import { listTodos } from "@/lib/boards/store";
import { t } from "@/lib/i18n/server";
import { listArtifacts } from "@/lib/work/branch-knowledge";
import { branchNameFor, namingBlock } from "@/lib/work/branch-naming";
import { addArtifactAction, deleteArtifactAction } from "@/plugins/work/branch-actions";

/**
 * Prompts → Branch names, beside the step's settings: the name a todo's branch gets (pick a todo), what its worker is told,
 * and the knowledge kept for naming (written by the briefing's AI from the messages it reads, each with its message).
 */
export function BranchNamingAdmin({ todoId }: { todoId?: number }) {
  const kept = listArtifacts();
  const todos = listTodos({ status: "open" }).filter((x) => x.ticket && !x.byWorker).slice(0, 60);
  const todo = todos.find((x) => x.id === todoId) ?? todos[0];
  const named = todo ? branchNameFor(todo) : null;
  const from = { kept: t("a change kept for the ticket"), todo: t("the todo's words"), ticket: t("the ticket's title") };
  return (
    <div className="space-y-5 border-t border-zinc-200 pt-4 dark:border-zinc-800">
      <section className="space-y-2">
        <h3 className="text-sm font-medium">{t("Preview")}</h3>
        {todos.length ? (
          <>
            <form method="get" action="/settings/prompts" className="flex flex-wrap items-center gap-2 text-sm">
              <select name="todo" defaultValue={todo?.id} className="input w-auto max-w-full text-sm" aria-label={t("Todo")}>
                {todos.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.ref} · {x.ticket} · {x.text.slice(0, 70)}
                  </option>
                ))}
              </select>
              <button className="btn btn-sm">{t("Show")}</button>
            </form>
            {todo && (
              <>
                <p className="text-sm">
                  {t("The branch gets the name")}: <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-base dark:bg-zinc-800">{named?.name ?? t("zeff/… (no words to make a name of)")}</code>
                </p>
                {named && (
                  <p className="text-xs text-zinc-500">
                    {t("From {source}: “{text}”", { source: from[named.from], text: named.text.slice(0, 120) })}
                  </p>
                )}
                <details className="text-sm">
                  <summary className="cursor-pointer text-zinc-500">{t("What the worker is told")}</summary>
                  <pre tabIndex={0} className="mt-1 max-h-96 overflow-auto rounded-md bg-zinc-50 p-2 text-xs whitespace-pre-wrap dark:bg-zinc-900">{namingBlock(todo).trim()}</pre>
                </details>
              </>
            )}
          </>
        ) : (
          <p className="text-sm text-zinc-400">{t("No open todo with a ticket to show it for.")}</p>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-medium">{t("Kept knowledge")}</h3>
        <p className="text-xs text-zinc-500">{t("The briefing's AI keeps what a message says about the code change or about naming branches — with that message. Only this goes into the naming.")}</p>
        {kept.length ? (
          <ul className="space-y-2">
            {kept.map((a) => (
              <li key={a.id} className="rounded-md border border-zinc-200 p-2 text-sm dark:border-zinc-700">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="rounded bg-zinc-100 px-1.5 text-xs dark:bg-zinc-800">{a.kind === "rule" ? t("Rule") : t("Code change")}</span>
                  <span className="font-mono text-xs text-zinc-500">{a.ticket}</span>
                  <span className="min-w-0 flex-1">{a.text}</span>
                  <form action={deleteArtifactAction}>
                    <input type="hidden" name="id" value={a.id} />
                    <button className="btn btn-sm btn-danger">{t("Delete")}</button>
                  </form>
                </div>
                {a.source && (
                  <blockquote className="mt-1 border-l-2 border-zinc-300 pl-2 text-xs text-zinc-500 dark:border-zinc-600">
                    <span className="font-medium">{a.source.label}:</span> „{a.source.text}“
                  </blockquote>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-zinc-400">{t("Nothing kept yet — the next briefing writes it where a message says something about it.")}</p>
        )}
        <details className="text-sm">
          <summary className="cursor-pointer text-zinc-500">{t("Add one by hand")}</summary>
          <form action={addArtifactAction} className="mt-1 flex flex-wrap gap-2">
            <input name="ticket" required placeholder="PROJ-306" className="input w-32 text-sm" aria-label={t("Ticket")} />
            <select name="kind" className="input w-auto text-sm" aria-label={t("Kind")}>
              <option value="change">{t("Code change")}</option>
              <option value="rule">{t("Rule")}</option>
            </select>
            <input name="text" required placeholder={t("The change in a few words, or the rule in a sentence")} className="input min-w-64 flex-1 text-sm" aria-label={t("Text")} />
            <input name="ref" placeholder={t("Message (teams:…, jira-comment:…)")} className="input w-64 text-sm" aria-label={t("Message it comes from")} />
            <button className="btn btn-primary btn-sm">{t("Keep")}</button>
          </form>
        </details>
      </section>
    </div>
  );
}
