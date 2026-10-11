import type { Metadata } from "next";
import { t } from "@/lib/i18n/server";
import Link from "next/link";
import { connection } from "next/server";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { findAllProgress } from "@/plugins/people/dates";
import { createPersonFormAction, dateFormAction, findAllDatesFormAction, updatePersonFormAction } from "@/plugins/people/server-actions";
import { dateKindLabels, dateText, inDaysText, upcomingShort, upcomingTitle } from "@/plugins/people/shared";
import { contactsOf, listPeople, proposedDates, upcoming, whatsappChats } from "@/plugins/people/store";
import { formatAgo } from "@/lib/format";
import { isInstalled } from "@/plugins/state";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("People") };
}

/** Who the knowledge knows that has no profile yet — the most named first. */
async function knowledgeSuggestions(taken: Set<string>) {
  if (!isInstalled("knowledge")) return { persons: [], error: null as string | null };
  try {
    const { knowledgePersons } = await import("@/plugins/knowledge/client");
    const persons = (await knowledgePersons()).filter((p) => p.pages >= 2 && ![p.name, ...p.aliases].some((n) => taken.has(n.toLowerCase())));
    return { persons: persons.slice(0, 24), error: null };
  } catch (e) {
    return { persons: [], error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Personen (the Personen plugin): everyone you keep a profile of — starred first, with what comes
 * up next and when you last heard from them; the dates found waiting for you; people to add from
 * the knowledge and your WhatsApp chats.
 */
export default async function PeoplePage({ searchParams }: { searchParams: Promise<{ error?: string; added?: string; searching?: string }> }) {
  await connection();
  if (!isInstalled("people")) return <PluginNotInstalled id="people" />;
  const sp = await searchParams;
  const people = listPeople();
  const soon = upcoming({ days: 60 });
  const proposals = proposedDates();
  const nextOf = new Map<number, (typeof soon)[number]>();
  for (const u of soon) if (!nextOf.has(u.person.id)) nextOf.set(u.person.id, u);
  const taken = new Set(people.flatMap((p) => [p.name, ...p.aliases, p.whatsapp].filter(Boolean).map((n) => n.toLowerCase())));
  const known = await knowledgeSuggestions(taken);
  const chats = whatsappChats().filter((c) => !taken.has(c.name.toLowerCase())).slice(0, 16);
  const progress = findAllProgress();

  return (
    <div className="page">
      <div className="page-aside">
        <h1 className="text-lg font-semibold">{t("People")}</h1>
        <p className="text-sm text-zinc-500">{t("The people who matter to you: their dates with reminders, your notes, what Zeff knows about them.")}</p>
        <form action={createPersonFormAction} className="flex gap-2">
          <input name="name" required placeholder={t("Name…")} className="input" aria-label={t("New person")} />
          <button className="btn btn-primary">{t("Add")}</button>
        </form>
        {sp.error && <p className="alert-error text-sm">{sp.error}</p>}
        {sp.added && <p className="alert-ok text-sm">{t("Added ✓")}</p>}
        {people.length > 0 &&
          (progress ? (
            <p className="text-sm text-zinc-500">
              <span className="mr-2 inline-block size-2 animate-pulse rounded-full bg-amber-500" />
              {t("Searching dates… {done} of {total} · {found} found", { done: progress.done, total: progress.total, found: progress.found })}
            </p>
          ) : (
            <form action={findAllDatesFormAction}>
              <button className="btn btn-sm" title={t("For everyone without a birthday: in the facts and (with the LLM plugin) by AI in the knowledge and the messages")}>
                {t("Find dates for everyone")}
              </button>
            </form>
          ))}
        {sp.searching && !progress && <p className="text-xs text-zinc-500">{t("Search done — suggestions are at the top right.")}</p>}
        {soon.length > 0 && (
          <section className="space-y-1">
            <h2 className="text-xs font-semibold text-zinc-500 uppercase">{t("Coming up")}</h2>
            <ul className="space-y-1 text-sm">
              {soon.slice(0, 12).map((u) => (
                <li key={`${u.date.id}`} className="flex items-baseline gap-2">
                  <Link href={`/personen/${u.person.id}`} className="min-w-0 flex-1 truncate hover:underline">
                    {upcomingTitle(u, t)}
                  </Link>
                  <span className={`shrink-0 text-xs ${u.inDays <= u.date.remindDays ? "font-medium text-amber-700 dark:text-amber-400" : "text-zinc-400"}`}>{inDaysText(u.inDays, u.on, t)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <div className="space-y-6">
        {proposals.length > 0 && (
          <section className="card space-y-2 p-4">
            <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("Dates found — are they right?")}</h2>
            <ul className="space-y-2">
              {proposals.map((d) => (
                <li key={d.id} className="flex flex-wrap items-baseline gap-2 text-sm">
                  <Link href={`/personen/${d.personId}`} className="font-medium hover:underline">
                    {d.personName}
                  </Link>
                  <span>
                    {d.kind === "other" ? d.label || t("Date") : dateKindLabels(t)[d.kind]}: {dateText(d)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs text-zinc-500" title={d.sourceText}>
                    {d.sourceText}
                  </span>
                  <form action={dateFormAction} className="flex gap-1">
                    <input type="hidden" name="id" value={d.id} />
                    <input type="hidden" name="to" value="/personen" />
                    <button name="op" value="confirm" className="btn btn-primary btn-sm">
                      {t("Right")}
                    </button>
                    <button name="op" value="delete" className="btn btn-sm">
                      {t("Wrong")}
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-zinc-500 uppercase">{people.length === 1 ? t("1 person") : t("{n} people", { n: people.length })}</h2>
          {people.length ? (
            <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {people.map((p) => {
                const next = nextOf.get(p.id);
                const last = contactsOf(p, 1)[0];
                return (
                  <li key={p.id} className="card flex items-start gap-2 p-3">
                    <form action={updatePersonFormAction}>
                      <input type="hidden" name="id" value={p.id} />
                      <input type="hidden" name="to" value="/personen" />
                      <input type="hidden" name="starred" value={p.starred ? "0" : "1"} />
                      <button
                        className={`text-lg leading-none ${p.starred ? "text-amber-500" : "text-zinc-300 hover:text-amber-400 dark:text-zinc-600"}`}
                        title={p.starred ? t("Don't keep at the top") : t("Keep at the top")}
                        aria-label={p.starred ? t("Remove star") : t("Add star")}
                      >
                        ★
                      </button>
                    </form>
                    <Link href={`/personen/${p.id}`} className="min-w-0 flex-1">
                      <span className="block truncate font-medium hover:underline">{p.name}</span>
                      <span className="block truncate text-xs text-zinc-500">
                        {next ? `${upcomingShort(next, t)} ${inDaysText(next.inDays, next.on, t)}` : t("no date coming up")}
                        {last ? ` · ${t("last {ago}", { ago: formatAgo(last.at) })}` : ""}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-zinc-500">{t("Nobody yet — add someone on the left, or take people over from the knowledge and WhatsApp below.")}</p>
          )}
        </section>

        {(known.persons.length > 0 || chats.length > 0 || known.error) && (
          <section className="card space-y-3 p-4">
            <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("Suggestions")}</h2>
            {known.error && <p className="text-xs text-amber-700 dark:text-amber-400">{t("Knowledge: {error}", { error: known.error })}</p>}
            {known.persons.length > 0 && (
              <div className="space-y-1">
                <h3 className="text-xs text-zinc-500">{t("From the knowledge — the most mentioned first")}</h3>
                <ul className="flex flex-wrap gap-1.5">
                  {known.persons.map((k) => (
                    <li key={k.id}>
                      <form action={createPersonFormAction}>
                        <input type="hidden" name="name" value={k.name} />
                        <input type="hidden" name="entityId" value={k.id} />
                        <input type="hidden" name="aliases" value={k.aliases.join(", ")} />
                        <input type="hidden" name="stay" value="1" />
                        <button
                          className="rounded-full border border-zinc-200 px-2 py-0.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                          title={`${k.summary} · ${t("{n} pages", { n: k.pages })}`}
                        >
                          + {k.name} <span className="text-xs text-zinc-400">{k.pages}</span>
                        </button>
                      </form>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {chats.length > 0 && (
              <div className="space-y-1">
                <h3 className="text-xs text-zinc-500">{t("From WhatsApp")}</h3>
                <ul className="flex flex-wrap gap-1.5">
                  {chats.map((c) => (
                    <li key={c.name}>
                      <form action={createPersonFormAction}>
                        <input type="hidden" name="name" value={c.name} />
                        <input type="hidden" name="whatsapp" value={c.name} />
                        <input type="hidden" name="stay" value="1" />
                        <button
                          className="rounded-full border border-zinc-200 px-2 py-0.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                          title={t("{n} messages, last {ago}", { n: c.messages, ago: formatAgo(c.lastAt) })}
                        >
                          + {c.name}
                        </button>
                      </form>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
