import type { Metadata } from "next";
import { t } from "@/lib/i18n/server";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import type { KnowledgeEntityDetail } from "@/plugins/knowledge/shared";
import { addDateFormAction, addRelationFormAction, dateFormAction, deletePersonFormAction, deleteRelationFormAction, findDatesFormAction, mergePersonFormAction, updatePersonFormAction } from "@/plugins/people/server-actions";
import { dateKindLabels, DATE_KINDS, dateText, daysBetween, inDaysText, isoDay, nextOccurrence } from "@/plugins/people/shared";
import { contactsOf, datesOf, getPerson, listPeople, namesThem, relationsOf, rememberEntity } from "@/plugins/people/store";
import { formatDate, formatDateTime } from "@/lib/format";
import { isInstalled } from "@/plugins/state";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Person") };
}

function Card({ title, children, extra }: { title: string; children: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <section className="card space-y-2 p-4">
      <h2 className="flex items-baseline justify-between gap-2 text-sm font-semibold text-zinc-500 uppercase">
        <span>{title}</span>
        {extra}
      </h2>
      {children}
    </section>
  );
}

/** What the knowledge knows of them: by the entity kept with the profile, else (or when normalizing merged it away) by name. */
async function knowledgeOf(p: NonNullable<ReturnType<typeof getPerson>>): Promise<{ entity: KnowledgeEntityDetail | null; error: string | null }> {
  if (!isInstalled("knowledge")) return { entity: null, error: null };
  try {
    const { knowledgePerson } = await import("@/plugins/knowledge/client");
    let entity = p.entityId ? await knowledgePerson({ id: p.entityId }) : null;
    if (!entity) for (const n of [p.name, ...p.aliases]) if ((entity = await knowledgePerson({ name: n }))) break;
    if (entity && entity.id !== p.entityId) rememberEntity(p.id, entity.id);
    return { entity, error: null };
  } catch (e) {
    return { entity: null, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * A person: their dates (with reminders; found ones to confirm), your notes, what the knowledge
 * knows of them, their latest messages, the todos naming them — and what they're called (name,
 * aliases, WhatsApp chat, mail addresses), so Zeff finds them.
 */
export default async function PersonPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; saved?: string; found?: string }> }) {
  await connection();
  if (!isInstalled("people")) return <PluginNotInstalled id="people" />;
  const p = getPerson(Number((await params).id));
  if (!p) notFound();
  const sp = await searchParams;
  const today = new Date();
  const dates = datesOf(p.id);
  const { entity, error: knowledgeError } = await knowledgeOf(p);
  const contacts = contactsOf(p, 12);
  let todos: { id: number; ref: string; text: string; due: string | null }[] = [];
  if (isInstalled("todos")) {
    const { listTodos } = await import("@/lib/boards/store");
    todos = listTodos({ status: "open" })
      .filter((todo) => namesThem(p, `${todo.text} ${todo.note ?? ""}`))
      .slice(0, 15)
      .map((todo) => ({ id: todo.id, ref: todo.ref, text: todo.text, due: todo.due }));
  }
  const h = await headers();
  let knowledgeBase = "";
  if (isInstalled("knowledge")) {
    const { knowledgeBrowserUrl } = await import("@/plugins/knowledge/client");
    knowledgeBase = knowledgeBrowserUrl(h.get("x-forwarded-host") ?? h.get("host"), h.get("x-forwarded-proto"));
  }
  const back = `/personen/${p.id}`;
  const relations = relationsOf(p.id);
  const others = listPeople().filter((x) => x.id !== p.id);
  // Relations by whom / what they're with.
  const related = new Map<number, { name: string; type: string; rels: string[] }>();
  for (const r of entity?.relations ?? []) {
    const g = related.get(r.other.id) ?? { name: r.other.name, type: r.other.type, rels: [] };
    const text = r.fact || `${r.dir === "out" ? "→" : "←"} ${r.rel}`;
    if (!g.rels.includes(text) && g.rels.length < 3) g.rels.push(text);
    related.set(r.other.id, g);
  }

  return (
    <div className="page">
      <div className="page-aside">
        <Link href="/personen" className="text-xs text-zinc-500 hover:underline">
          {t("← People")}
        </Link>
        <div className="flex items-start gap-2">
          <form action={updatePersonFormAction}>
            <input type="hidden" name="id" value={p.id} />
            <input type="hidden" name="starred" value={p.starred ? "0" : "1"} />
            <button className={`text-xl leading-none ${p.starred ? "text-amber-500" : "text-zinc-300 hover:text-amber-400 dark:text-zinc-600"}`} aria-label={p.starred ? t("Remove star") : t("Add star")}>
              ★
            </button>
          </form>
          <h1 className="text-lg font-semibold break-words">{p.name}</h1>
        </div>
        {p.aliases.length > 0 && <p className="text-xs text-zinc-500">{t("Also: {names}", { names: p.aliases.join(", ") })}</p>}
        {(p.accounts.length > 0 || p.emails.length > 0 || p.whatsapp) && (
          <ul className="flex flex-wrap gap-1.5 text-xs" aria-label={t("Linked accounts")}>
            {p.accounts.map((a) => (
              <li key={`${a.kind}:${a.value}`} className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-100" title={t("Jira user — @-mentions of {name} in notes synced to Jira point to it", { name: p.name })}>
                Jira <span className="font-mono">~{a.value}</span>
              </li>
            ))}
            {p.emails.map((e) => (
              <li key={e} className="rounded-full border border-zinc-200 px-2 py-0.5 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">
                {e}
              </li>
            ))}
            {p.whatsapp && <li className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100">WhatsApp {p.whatsapp}</li>}
          </ul>
        )}
        {sp.error && <p className="alert-error text-sm">{sp.error}</p>}
        {sp.saved && <p className="alert-ok text-sm">{t("Saved ✓")}</p>}
        {sp.found !== undefined && (
          <p className="alert-ok text-sm">
            {sp.found === "0" ? t("No new dates found.") : sp.found === "1" ? t("1 date found — confirm below.") : t("{n} dates found — confirm below.", { n: sp.found })}
          </p>
        )}
        <details>
          <summary className="cursor-pointer text-sm text-zinc-600 dark:text-zinc-300">{t("Name, aliases, WhatsApp, mail")}</summary>
          <form action={updatePersonFormAction} className="mt-2 space-y-2 text-sm">
            <input type="hidden" name="id" value={p.id} />
            <label className="block">
              <span className="label">{t("Name")}</span>
              <input name="name" defaultValue={p.name} className="input" />
            </label>
            <label className="block">
              <span className="label">{t("Also called (comma-separated)")}</span>
              <input name="aliases" defaultValue={p.aliases.join(", ")} className="input" />
            </label>
            <label className="block">
              <span className="label">{t("Jira usernames (comma-separated) — for @-mentions in Jira comments")}</span>
              <input name="jiraAccounts" defaultValue={p.accounts.filter((a) => a.kind === "jira").map((a) => a.value).join(", ")} className="input font-mono text-xs" placeholder="chrlorenz1" />
            </label>
            <label className="block">
              <span className="label">{t("WhatsApp chat (its name)")}</span>
              <input name="whatsapp" defaultValue={p.whatsapp} className="input" />
            </label>
            <label className="block">
              <span className="label">{t("Mail addresses (comma-separated)")}</span>
              <input name="emails" defaultValue={p.emails.join(", ")} className="input" />
            </label>
            <button className="btn btn-primary btn-sm">{t("Save")}</button>
          </form>
          {listPeople().length > 1 && (
            <form action={mergePersonFormAction} className="mt-3 space-y-1">
              <input type="hidden" name="drop" value={p.id} />
              <span className="label">{t("Same person as …")}</span>
              <div className="flex gap-2">
                <select name="keep" required defaultValue="" className="input min-w-0 flex-1" aria-label={t("Same person as …")}>
                  <option value="" disabled>
                    {t("Pick a profile …")}
                  </option>
                  {listPeople()
                    .filter((x) => x.id !== p.id)
                    .map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                </select>
                <button className="btn btn-sm">{t("Merge into it")}</button>
              </div>
              <p className="text-xs text-zinc-400">{t("“{name}” becomes an alias of the chosen profile; its chat, addresses, notes and dates come along; this profile is removed.", { name: p.name })}</p>
            </form>
          )}
          <form action={deletePersonFormAction} className="mt-3">
            <input type="hidden" name="id" value={p.id} />
            <button className="btn btn-sm text-red-700 dark:text-red-400">{t("Delete profile")}</button>
          </form>
        </details>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title={t("Relations")}>
          <ul className="space-y-1 text-sm">
            {relations.out.map((r) => (
              <li key={r.id} className="flex items-baseline gap-2" title={r.evidence || undefined}>
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{r.rel}</span>
                  {r.otherId ? (
                    <>
                      {" "}
                      {t("of")}{" "}
                      <Link href={`/personen/${r.otherId}`} className="hover:underline">
                        {r.otherName}
                      </Link>
                    </>
                  ) : (
                    <span className="text-zinc-400"> {t("(to you)")}</span>
                  )}
                  {r.evidence && <span className="block text-xs text-zinc-400">{r.evidence}</span>}
                </span>
                <form action={deleteRelationFormAction}>
                  <input type="hidden" name="id" value={r.id} />
                  <input type="hidden" name="personId" value={p.id} />
                  <button className="text-xs text-zinc-400 hover:text-red-600" aria-label={t("Remove")} title={t("Wrong? Remove it.")}>
                    ✕
                  </button>
                </form>
              </li>
            ))}
            {relations.in.map((r) => (
              <li key={r.id} className="flex items-baseline gap-2" title={r.evidence || undefined}>
                <span className="min-w-0 flex-1">
                  <Link href={`/personen/${r.personId}`} className="hover:underline">
                    {r.personName}
                  </Link>
                  : <span className="font-medium">{r.rel}</span>
                  {r.evidence && <span className="block text-xs text-zinc-400">{r.evidence}</span>}
                </span>
                <form action={deleteRelationFormAction}>
                  <input type="hidden" name="id" value={r.id} />
                  <input type="hidden" name="personId" value={p.id} />
                  <button className="text-xs text-zinc-400 hover:text-red-600" aria-label={t("Remove")} title={t("Wrong? Remove it.")}>
                    ✕
                  </button>
                </form>
              </li>
            ))}
          </ul>
          {!relations.out.length && !relations.in.length && <p className="text-xs text-zinc-400">{t("None known yet — the AI derives them from your todos and messages (“Match names”), or add one.")}</p>}
          <form action={addRelationFormAction} className="flex flex-wrap gap-2 text-sm">
            <input type="hidden" name="personId" value={p.id} />
            <input name="rel" required placeholder={t("e.g. mother, landlord")} className="input min-w-0 flex-1" aria-label={t("Relation")} />
            <select name="other" defaultValue="0" className="input w-40" aria-label={t("To whom")}>
              <option value="0">{t("to you")}</option>
              {others.map((x) => (
                <option key={x.id} value={x.id}>
                  {t("of {name}", { name: x.name })}
                </option>
              ))}
            </select>
            <button className="btn btn-sm">{t("Add")}</button>
          </form>
        </Card>
        <Card
          title={t("Dates")}
          extra={
            <form action={findDatesFormAction}>
              <input type="hidden" name="personId" value={p.id} />
              <button
                className="text-xs font-normal tracking-normal text-indigo-600 normal-case hover:underline dark:text-indigo-400"
                title={t("In the facts and (with the LLM plugin) by AI in the knowledge and the messages")}
              >
                {t("Find dates")}
              </button>
            </form>
          }
        >
          {dates.length ? (
            <ul className="space-y-2">
              {dates.map((d) => {
                const on = nextOccurrence(d, today);
                const inDays = on ? daysBetween(today, on) : null;
                return (
                  <li key={d.id} className={`space-y-1 text-sm ${d.confirmed ? "" : "rounded-md bg-amber-50 p-2 dark:bg-amber-950/40"}`}>
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="font-medium">{d.kind === "other" ? d.label || t("Date") : dateKindLabels(t)[d.kind]}</span>
                      <span className="tabular-nums">{dateText(d)}</span>
                      {on && inDays !== null && (
                        <span className="text-xs text-zinc-500">
                          {inDaysText(inDays, isoDay(on), t)}
                          {d.year && d.yearly && d.kind === "birthday" ? ` · ${t("turns {age}", { age: on.getFullYear() - d.year })}` : ""}
                        </span>
                      )}
                      {!d.confirmed && <span className="text-xs text-amber-700 dark:text-amber-400">{t("found — is it right?")}</span>}
                    </div>
                    {d.sourceText && <p className="text-xs text-zinc-500">{d.sourceText}</p>}
                    <form action={dateFormAction} className="flex flex-wrap items-center gap-1.5 text-xs">
                      <input type="hidden" name="id" value={d.id} />
                      <input type="hidden" name="to" value={back} />
                      {!d.confirmed && (
                        <button name="op" value="confirm" className="btn btn-primary btn-sm">
                          {t("Right")}
                        </button>
                      )}
                      {d.confirmed && (
                        <>
                          <span className="text-zinc-500">{t("remind")}</span>
                          <input name="remindDays" type="number" min={0} max={60} defaultValue={d.remindDays} className="input w-16 py-0.5 text-xs" aria-label={t("Days before to remind")} />
                          <span className="text-zinc-500">{t("days before")}</span>
                          <button name="op" value="remind" className="btn btn-sm">
                            {t("OK")}
                          </button>
                        </>
                      )}
                      <button name="op" value="delete" className="btn btn-sm">
                        {d.confirmed ? t("Delete") : t("Wrong")}
                      </button>
                    </form>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-zinc-500">{t("No date yet — enter one or let Zeff search (“Find dates”).")}</p>
          )}
          <form action={addDateFormAction} className="flex flex-wrap items-end gap-2 border-t border-zinc-200 pt-3 text-sm dark:border-zinc-800">
            <input type="hidden" name="personId" value={p.id} />
            <select name="kind" className="input w-auto" aria-label={t("Kind")}>
              {DATE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {dateKindLabels(t)[k]}
                </option>
              ))}
            </select>
            <input name="date" required placeholder={t("16.10. or 16.10.1996")} className="input w-40" aria-label={t("Date")} />
            <input name="label" placeholder={t("what for (other dates)")} className="input min-w-32 flex-1" aria-label={t("Label")} />
            <button className="btn btn-sm">{t("Add")}</button>
          </form>
        </Card>

        <Card title={t("Notes")}>
          <form action={updatePersonFormAction} className="space-y-2">
            <input type="hidden" name="id" value={p.id} />
            <textarea
              name="note"
              defaultValue={p.note}
              rows={Math.min(14, Math.max(4, p.note.split("\n").length + 1))}
              placeholder={t("What you want to remember about them — preferences, gift ideas, what you last talked about…")}
              className="input resize-y text-sm"
            />
            <button className="btn btn-sm">{t("Save")}</button>
          </form>
        </Card>

        {isInstalled("knowledge") && (
          <Card
            title={t("What the knowledge knows")}
            extra={
              entity && knowledgeBase ? (
                <a href={`${knowledgeBase}/graph?e=${entity.id}`} target="_blank" rel="noreferrer" className="text-xs font-normal tracking-normal text-indigo-600 normal-case hover:underline dark:text-indigo-400">
                  {t("In the graph ↗")}
                </a>
              ) : undefined
            }
          >
            {knowledgeError && <p className="text-xs text-amber-700 dark:text-amber-400">{knowledgeError}</p>}
            {entity ? (
              <>
                {entity.summary && <p className="text-sm">{entity.summary}</p>}
                {related.size > 0 && (
                  <ul className="space-y-1 text-sm">
                    {[...related.entries()].slice(0, 15).map(([id, g]) => (
                      <li key={id}>
                        <span className="font-medium">{g.name}</span>
                        {g.rels.map((r, i) => (
                          <span key={i} className="block text-xs text-zinc-500">
                            {r}
                          </span>
                        ))}
                      </li>
                    ))}
                  </ul>
                )}
                {entity.pages.length > 0 && (
                  <details>
                    <summary className="cursor-pointer text-xs text-zinc-500">{t("{n} pages", { n: entity.pages.length })}</summary>
                    <ul className="mt-1 space-y-1 text-sm">
                      {entity.pages.slice(0, 30).map((pg) => (
                        <li key={pg.id}>
                          <a href={`${knowledgeBase}/seite/${encodeURIComponent(pg.id)}`} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline dark:text-indigo-400">
                            {pg.title}
                          </a>{" "}
                          <span className="text-xs text-zinc-400">{pg.space}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </>
            ) : (
              !knowledgeError && <p className="text-sm text-zinc-500">{t("The knowledge knows nobody of this name. An alias — what the person is called in your pages — helps.")}</p>
            )}
          </Card>
        )}

        <Card title={t("Latest messages")}>
          {contacts.length ? (
            <ul className="space-y-1.5 text-sm">
              {contacts.map((c) => (
                <li key={c.key}>
                  <div className="flex items-baseline gap-2 text-xs text-zinc-500">
                    <span>{c.folder}</span>
                    <span>{c.who}</span>
                    <span className="ml-auto">{formatDateTime(c.at)}</span>
                  </div>
                  <p className="line-clamp-2">{c.text}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-zinc-500">{t("No messages — enter the WhatsApp chat or the mail addresses above.")}</p>
          )}
        </Card>

        {isInstalled("todos") && (
          <Card title={t("Todos they appear in")}>
            {todos.length ? (
              <ul className="space-y-1.5 text-sm">
                {todos.map((todo) => (
                  <li key={todo.id} className="flex items-baseline gap-2">
                    <Link href={`/t/${todo.id}`} className="font-mono text-xs text-zinc-400 hover:underline">
                      {todo.ref}
                    </Link>
                    <span className="min-w-0 flex-1">{todo.text}</span>
                    {todo.due && <span className="shrink-0 text-xs text-zinc-500">{formatDate(todo.due, { weekday: false })}</span>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-zinc-500">{t("No open todo names them.")}</p>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
