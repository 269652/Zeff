import { EmptyState } from "@/components/EmptyState";
import type { Metadata } from "next";
import { t } from "@/lib/i18n/server";
import Link from "next/link";
import { connection } from "next/server";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { findAllProgress } from "@/plugins/people/dates";
import { createPersonFormAction, dateFormAction, extractKnowledgeFormAction, reviewSuggestionFormAction, findAllDatesFormAction, importPeopleFormAction, linkJiraAccountsFormAction, normalizePeopleFormAction, updatePersonFormAction } from "@/plugins/people/server-actions";
import { pendingSuggestions } from "@/plugins/people/identity";
import { KnowledgeReview } from "@/plugins/people/KnowledgeViews";
import { PeopleList } from "@/plugins/people/PeopleList";
import { dateKindLabels, dateText, inDaysText, upcomingShort, upcomingTitle } from "@/plugins/people/shared";
import { contactsOf, listPeople, proposedDates, upcoming, whatsappChats } from "@/plugins/people/store";
import { formatAgo } from "@/lib/format";
import { isInstalled } from "@/plugins/state";
import { SubmitButton } from "@/components/SubmitButton";

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
export default async function PeoplePage({ searchParams }: { searchParams: Promise<{ read?: string; error?: string; added?: string; searching?: string; matched?: string; linked?: string; imported?: string }> }) {
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
  const identities = pendingSuggestions();

  return (
    <div className="page">
      <div className="page-aside">
        <h1 className="text-lg font-semibold">{t("People")}</h1>
        <p className="text-sm text-zinc-500">{t("The people who matter to you: their dates with reminders, your notes, what Zeff knows about them.")}</p>
        <form action={createPersonFormAction} className="flex gap-2">
          <input name="name" required placeholder={t("Name…")} className="input" aria-label={t("New person")} />
          <button className="btn btn-primary">{t("Add")}</button>
        </form>
        {sp.error && <p role="alert" className="alert-error text-sm">{sp.error}</p>}
        {sp.added && <p role="status" className="alert-ok text-sm">{t("Added ✓")}</p>}
        <Link href="/personen/compile" className="btn btn-sm w-full text-center" title={t("A summary of every person: what connects you, the key facts, the fun facts")}>
          {t("Compile summaries")}
        </Link>
        <form action={importPeopleFormAction}>
          <SubmitButton className="btn btn-primary btn-sm w-full" pendingText={t("Reading your context … (a minute or two)")} title={t("The AI goes through the last 14 days of your mails, WhatsApp and Signal chats, Teams, Jira and GitLab and makes a profile of every real person in them — with their other names, mail addresses, chats and Jira users. People you have get what's new about them.")}>
            {t("Import from context (AI)")}
          </SubmitButton>
        </form>
        {sp.imported !== undefined &&
          (() => {
            const [c, u, k] = sp.imported.split(",").map(Number);
            return <p role="status" className="alert-ok text-sm">{t("{c} new people, {u} updated — from {k} contacts of the last 14 days", { c: c || 0, u: u || 0, k: k || 0 })}</p>;
          })()}
        {people.length > 0 &&
          (progress ? (
            <p className="text-sm text-zinc-500">
              <span className="mr-2 inline-block size-2 animate-pulse rounded-full bg-amber-500" />
              {t("Searching dates… {done} of {total} · {found} found", { done: progress.done, total: progress.total, found: progress.found })}
            </p>
          ) : (
            <form action={findAllDatesFormAction}>
              <button className="btn btn-sm w-full" title={t("For everyone without a birthday: in the facts and (with the LLM plugin) by AI in the knowledge and the messages")}>
                {t("Find dates for everyone")}
              </button>
            </form>
          ))}
        {sp.searching && !progress && <p className="text-xs text-zinc-500">{t("Search done — suggestions are at the top right.")}</p>}
        {people.length > 1 && (
          <form action={normalizePeopleFormAction}>
            <button
              className="btn btn-sm w-full"
              title={t("The AI looks at who the names in your todos are: new names become aliases, contacts get profiles, duplicates are merged. It also runs after each briefing.")}
            >
              {t("Match names (AI)")}
            </button>
          </form>
        )}
        {people.length > 0 && (
          <form action={extractKnowledgeFormAction} className="flex gap-1">
            <button className="btn btn-sm min-w-0 flex-1" title={t("The AI reads the messages that came in since the last time (mail, chats, Teams, Jira) and notes what they say about people: roles, who is responsible for what, commitments. It also runs after each briefing; the result waits for your review.")}>
              {t("Read new messages (AI)")}
            </button>
            <select name="days" defaultValue="0" className="input w-24 text-xs" aria-label={t("Look back")}>
              <option value="0">{t("since last")}</option>
              <option value="14">{t("14 days")}</option>
              <option value="30">{t("30 days")}</option>
            </select>
          </form>
        )}
        {sp.read !== undefined &&
          (() => {
            const [i, c, l] = sp.read.split(",").map(Number);
            return <p role="status" className="alert-ok text-sm">{t("{i} messages read — {c} claims, {l} links", { i: i || 0, c: c || 0, l: l || 0 })}</p>;
          })()}
        {people.length > 0 && (
          <form action={linkJiraAccountsFormAction}>
            <button className="btn btn-sm w-full" title={t("Ties Jira users to the profiles by their names (as the briefing lists them on the tickets) — so @-mentions in notes synced to Jira point to the right person. No AI; names that fit two users aren't guessed.")}>
              {t("Link Jira accounts")}
            </button>
          </form>
        )}
        {sp.linked !== undefined && <p role="status" className="alert-ok text-sm">{sp.linked === "0" ? t("No new Jira accounts found.") : t("{n} Jira accounts linked.", { n: sp.linked })}</p>}
        {sp.matched !== undefined &&
          (() => {
            const [a, c, m, r] = sp.matched.split(",").map(Number);
            return <p role="status" className="alert-ok text-sm">{t("{a} aliases, {c} new, {m} merged, {r} relations", { a: a || 0, c: c || 0, m: m || 0, r: r || 0 })}</p>;
          })()}
        <p className="text-xs text-zinc-400">{t("Two profiles that are one person? Open one: “Same person as …” merges it into the other.")}</p>
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
        {identities.length > 0 && (
          <section className="card space-y-2 p-4">
            <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("Same person? — please check")}</h2>
            <ul className="space-y-2">
              {identities.slice(0, 30).map((s) => {
                const target = people.find((p) => p.id === s.personId);
                const other = people.find((p) => p.id === s.otherId);
                return (
                  <li key={s.id} className="flex flex-wrap items-baseline gap-2 text-sm">
                    <span className="min-w-0">
                      {s.kind === "merge" && t("Merge {other} into {name}", { other: other?.name ?? s.name, name: target?.name ?? "?" })}
                      {s.kind === "alias" && t("“{alias}” is another name of {name}", { alias: s.name, name: target?.name ?? "?" })}
                      {s.kind === "person" && t("New profile for {name}", { name: s.name })}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs text-zinc-500" title={s.evidence}>
                      {s.evidence} · {Math.round(s.confidence * 100)}%
                    </span>
                    <form action={reviewSuggestionFormAction} className="flex gap-1">
                      <input type="hidden" name="id" value={s.id} />
                      <button name="op" value="accept" className="btn btn-primary btn-sm">
                        {t("Right")}
                      </button>
                      <button name="op" value="reject" className="btn btn-sm">
                        {t("Wrong")}
                      </button>
                    </form>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <KnowledgeReview />

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
            <PeopleList
              rows={people.map((p) => {
                const next = nextOf.get(p.id);
                const last = contactsOf(p, 1)[0];
                return {
                  id: p.id,
                  name: p.name,
                  aliases: p.aliases,
                  emails: p.emails,
                  note: p.note,
                  starred: p.starred,
                  createdAt: p.createdAt,
                  nextDays: next ? next.inDays : null,
                  lastAt: last?.at ?? null,
                  aliasLine: [...p.aliases, ...p.accounts.map((a) => `~${a.value}`)].join(" · "),
                  aliasTitle: [...p.aliases, ...p.accounts.map((a) => `Jira ~${a.value}`)].join(" · "),
                  dateLine: `${next ? `${upcomingShort(next, t)} ${inDaysText(next.inDays, next.on, t)}` : t("no date coming up")}${last ? ` · ${t("last {ago}", { ago: formatAgo(last.at) })}` : ""}`,
                };
              })}
            />
          ) : (
            <EmptyState>{t("Nobody yet — import them from your context on the left (the AI reads the last 14 days), add someone by hand, or take people over from the knowledge and WhatsApp below.")}</EmptyState>
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
