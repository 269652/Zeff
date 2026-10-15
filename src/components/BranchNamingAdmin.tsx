import { listTodos } from "@/lib/boards/store";
import { t } from "@/lib/i18n/server";
import { namingBlock, namingContext, proposeBranchName } from "@/lib/work/branch-naming";
import { listBranchRules, suggestRuleMessages } from "@/lib/work/branch-rules";
import { addBranchRuleAction, deleteBranchRuleAction, toggleBranchRuleAction } from "@/plugins/work/branch-actions";

/**
 * Auswerten → Branch names, beside the step's settings: the rules colleagues gave (each with the message it comes
 * from), messages that read like one to keep, and the preview — for a todo, every kind of context with what the
 * settings let in, the block the worker would get and the name Zeff would give its branch.
 */
export function BranchNamingAdmin({ todoId }: { todoId?: number }) {
  const rules = listBranchRules();
  const suggestions = suggestRuleMessages(8);
  const todos = listTodos({ status: "open" }).filter((x) => x.ticket && !x.byWorker).slice(0, 60);
  const todo = todos.find((x) => x.id === todoId) ?? todos[0];
  const items = todo ? namingContext(todo) : [];
  const labels: Record<string, string> = { rules: t("Rules"), knowledge: t("Kept knowledge of the ticket"), ticket: t("The Jira ticket"), comments: t("Jira comments"), todo: t("The todo"), branches: t("Branches already there") };
  return (
    <div className="space-y-5 border-t border-zinc-200 pt-4 dark:border-zinc-800">
      <section className="space-y-2">
        <h3 className="text-sm font-medium">{t("Rules")}</h3>
        <p className="text-xs text-zinc-500">{t("What colleagues said about naming branches — kept with the message it comes from, so it stays when the message is gone. The worker gets the rules of the ticket's project.")}</p>
        {rules.length ? (
          <ul className="space-y-2">
            {rules.map((r) => (
              <li key={r.id} className={`rounded-md border border-zinc-200 p-2 text-sm dark:border-zinc-700 ${r.enabled ? "" : "opacity-60"}`}>
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="min-w-0 flex-1">{r.text}</span>
                  <span className="rounded bg-zinc-100 px-1.5 text-xs dark:bg-zinc-800">{r.scope === "*" ? t("all tickets") : r.scope}</span>
                  <form action={toggleBranchRuleAction}>
                    <input type="hidden" name="id" value={r.id} />
                    <input type="hidden" name="enabled" value={r.enabled ? "0" : "1"} />
                    <button className="btn btn-sm">{r.enabled ? t("Turn off") : t("Turn on")}</button>
                  </form>
                  <form action={deleteBranchRuleAction}>
                    <input type="hidden" name="id" value={r.id} />
                    <button className="btn btn-sm btn-danger">{t("Delete")}</button>
                  </form>
                </div>
                {r.sources.map((s) => (
                  <blockquote key={s.ref} className="mt-1 border-l-2 border-zinc-300 pl-2 text-xs text-zinc-500 dark:border-zinc-600">
                    <span className="font-medium">{s.label}:</span> „{s.text}“
                  </blockquote>
                ))}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-zinc-400">{t("No rules yet.")}</p>
        )}
        {suggestions.length > 0 && (
          <div className="space-y-1.5">
            <h4 className="text-xs font-semibold text-zinc-500 uppercase">{t("Messages that read like a rule")}</h4>
            {suggestions.map((s) => (
              <form key={s.ref} action={addBranchRuleAction} className="space-y-1 rounded-md bg-zinc-50 p-2 text-sm dark:bg-zinc-900/50">
                <p className="text-xs text-zinc-500">
                  {s.label}: „{s.text}“
                </p>
                <input type="hidden" name="refs" value={s.ref} />
                <textarea name="text" rows={2} defaultValue={s.text.slice(0, 280)} className="input w-full text-sm" aria-label={t("The rule, in a sentence")} />
                <div className="flex flex-wrap items-center gap-2">
                  <input name="scope" placeholder={t("Project (e.g. PROJ) — empty: all")} className="input w-56 text-sm" aria-label={t("Project")} />
                  <button className="btn btn-primary btn-sm">{t("Keep as a rule")}</button>
                </div>
              </form>
            ))}
          </div>
        )}
        <details className="text-sm">
          <summary className="cursor-pointer text-zinc-500">{t("Add a rule by hand")}</summary>
          <form action={addBranchRuleAction} className="mt-1 space-y-1">
            <textarea name="text" rows={2} required className="input w-full text-sm" placeholder={t("The rule, in a sentence")} aria-label={t("The rule, in a sentence")} />
            <div className="flex flex-wrap gap-2">
              <input name="scope" placeholder={t("Project (e.g. PROJ) — empty: all")} className="input w-56 text-sm" aria-label={t("Project")} />
              <input name="refs" placeholder={t("Messages it comes from (teams:…, jira-comment:…)")} className="input min-w-64 flex-1 text-sm" aria-label={t("Messages it comes from")} />
              <button className="btn btn-primary btn-sm">{t("Keep")}</button>
            </div>
          </form>
        </details>
      </section>

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
                  {t("Zeff names the worker's branch")}: <code className="rounded bg-zinc-100 px-1.5 py-0.5 dark:bg-zinc-800">{proposeBranchName(todo) ?? t("zeff/… (nothing short to say yet)")}</code>
                </p>
                <ul className="space-y-1.5">
                  {items.map((i) => (
                    <li key={i.key} className={`rounded-md border p-2 text-sm ${i.included ? "border-emerald-200 dark:border-emerald-900" : "border-zinc-200 opacity-60 dark:border-zinc-700"}`}>
                      <div className="flex items-baseline gap-2">
                        <span className="font-medium">{labels[i.key] ?? i.label}</span>
                        <span className={`text-xs ${i.included ? "text-emerald-700 dark:text-emerald-400" : "text-zinc-500"}`}>{i.included ? t("goes in") : t("turned off")}</span>
                        {!i.lines.length && <span className="text-xs text-zinc-400">{t("nothing found")}</span>}
                      </div>
                      {i.lines.length > 0 && (
                        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-zinc-600 dark:text-zinc-300">
                          {i.lines.map((l, n) => (
                            <li key={n} className="whitespace-pre-wrap">
                              {l}
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
                <details className="text-sm">
                  <summary className="cursor-pointer text-zinc-500">{t("The block the worker gets")}</summary>
                  <pre className="mt-1 max-h-96 overflow-auto rounded-md bg-zinc-50 p-2 text-xs whitespace-pre-wrap dark:bg-zinc-900">{namingBlock(todo).trim()}</pre>
                </details>
              </>
            )}
          </>
        ) : (
          <p className="text-sm text-zinc-400">{t("No open todo with a ticket to show it for.")}</p>
        )}
      </section>
    </div>
  );
}
