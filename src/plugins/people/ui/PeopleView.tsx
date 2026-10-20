"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import type { Row } from "@/plugins/workspace/model";
import type { AppViewProps } from "@/plugins/workspace/ui/app-view";
import { initials } from "@/plugins/workspace/widget-shared";
import { peopleOverviewAction, peopleToolAction } from "../block-actions";
import type { PeopleOverview, PeopleTool } from "../tools";

/**
 * The people database's overview: the people themselves — cards to filter and sort (the database's search narrows them), each with what connects you, the
 * next date and the open todos — beside what comes up and what to check (names that may be one person, what the AI read, dates
 * it found, who to take over). The tools (import, find dates, match names, read messages, link Jira, compile) fold away.
 */

/** The people source's fixed field ids (workspace-source.ts). */
const F = { starred: "peoplestar", next: "peoplenext", nextKind: "peoplenextkind", context: "peoplecontext", todos: "peopletodos", tickets: "peopletickets", emails: "peopleemails" };

type Filter = "all" | "starred" | "todos" | "soon";
type Sort = "name" | "next" | "todos";

const TONES = ["bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300", "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300", "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300", "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300", "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300", "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300"];
/** A name's colour: always the same one for the same name. */
const toneOf = (name: string) => TONES[[...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % TONES.length];

/** A row as the card needs it. */
function personOf(r: Row) {
  const text = (id: string) => String(r.cells[id] ?? "").trim();
  const count = (id: string) => (text(id) ? text(id).split(" · ").length : 0);
  return { id: r.id, name: r.title || "—", starred: r.cells[F.starred] === true, next: text(F.next) || null, nextKind: text(F.nextKind), context: text(F.context), todos: count(F.todos), tickets: text(F.tickets) ? text(F.tickets).split(/,\s*/).length : 0, email: text(F.emails).split(/,\s*/)[0] ?? "" };
}

function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="card space-y-2 p-4">
      <div className="flex items-baseline gap-2">
        <h2 className="flex-1 text-xs font-semibold text-zinc-500 uppercase">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export default function PeopleView({ rows, openRow }: AppViewProps) {
  const t = useT();
  const router = useRouter();
  const [o, setO] = useState<PeopleOverview | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [days, setDays] = useState("0");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("name");
  const load = useCallback(async () => {
    const r = await peopleOverviewAction();
    if (r.ok) setO(r.overview);
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read when shown (the state is set once the answer is there)
    void load();
  }, [load]);
  // Running things (finding dates, compiling) go on in the background: look again until they are done.
  const running = !!o?.progress.dates || !!o?.progress.compile;
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => void load(), 4000);
    return () => clearInterval(id);
  }, [running, load]);

  // "Soon": today to 30 days ahead — fixed when the view opens.
  const [[today, in30]] = useState(() => [new Date().toISOString().slice(0, 10), new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10)]);
  const people = useMemo(() => {
    const list = rows
      .map(personOf)
      .filter((p) => (filter === "starred" ? p.starred : filter === "todos" ? p.todos > 0 : filter === "soon" ? !!p.next && p.next >= today && p.next <= in30 : true));
    const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "de");
    return list.sort((a, b) =>
      sort === "next" ? (a.next ?? "9999").localeCompare(b.next ?? "9999") || byName(a, b) : sort === "todos" ? b.todos - a.todos || byName(a, b) : Number(b.starred) - Number(a.starred) || byName(a, b),
    );
  }, [rows, filter, sort, today, in30]);

  const run = async (tool: PeopleTool, key: string) => {
    setBusy(key);
    const r = await peopleToolAction(tool);
    setBusy(null);
    if (!r.ok) toast(r.error, { tone: "error" });
    else if (r.message) toast(r.message);
    await load();
    router.refresh();
  };
  const rowOfPerson = (personId: number) => rows.find((r) => r.cells.srcref === `person:${personId}`);
  const person = (personId: number, label: string) => {
    const row = rowOfPerson(personId);
    return row ? (
      <button type="button" className="font-medium hover:underline" onClick={() => openRow(row.id)}>
        {label}
      </button>
    ) : (
      <span className="font-medium">{label}</span>
    );
  };
  if (!o) return <p className="text-sm text-zinc-400">…</p>;
  const tool = (key: string, label: string, op: PeopleTool, title?: string, primary = false) => (
    <button type="button" className={`btn btn-sm ${primary ? "btn-primary" : ""}`} disabled={busy !== null} title={title} onClick={() => void run(op, key)}>
      {busy === key ? "…" : label}
    </button>
  );
  const toCheck = o.identities.length + o.claims.length + o.links.length + o.stale.length + o.owed.length + o.dates.length;
  const day = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  const filters: { id: Filter; label: string }[] = [
    { id: "all", label: t("All") },
    { id: "starred", label: t("Starred") },
    { id: "todos", label: t("With todos") },
    { id: "soon", label: t("Dates soon") },
  ];

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]" data-app-view="people">
      <div className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1" role="group" aria-label={t("Filter")}>
            {filters.map((f) => (
              <button key={f.id} type="button" aria-pressed={filter === f.id} className={`rounded-full px-2.5 py-0.5 text-sm ${filter === f.id ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"}`} onClick={() => setFilter(f.id)}>
                {f.label}
              </button>
            ))}
          </div>
          <select className="input w-48 text-sm" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label={t("Sort")}>
            <option value="name">{t("By name")}</option>
            <option value="next">{t("Next date first")}</option>
            <option value="todos">{t("Most todos first")}</option>
          </select>
          <span className="flex-1" />
          <form
            className="flex gap-1"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!name.trim()) return;
              await run({ tool: "add", name }, "add");
              setName("");
            }}
          >
            <input className="input w-40" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("Name…")} aria-label={t("New person")} />
            <button className="btn btn-primary btn-sm" disabled={busy !== null}>
              + {t("Person")}
            </button>
          </form>
        </div>

        <p className="text-xs text-zinc-500">
          {people.length === rows.length ? (o.count === 1 ? t("1 person") : t("{n} people", { n: o.count })) : t("{n} of {total}", { n: people.length, total: rows.length })}
        </p>

        {people.length ? (
          <ul className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-3">
            {people.map((p) => {
              const soon = !!p.next && p.next >= today && p.next <= in30;
              return (
                <li key={p.id}>
                  <button type="button" className="card flex h-full w-full items-start gap-3 p-3 text-left transition hover:border-zinc-300 hover:shadow-sm dark:hover:border-zinc-600" onClick={() => openRow(p.id)}>
                    <span className={`flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${toneOf(p.name)}`} aria-hidden>
                      {initials(p.name) || "?"}
                    </span>
                    <span className="min-w-0 flex-1 space-y-1">
                      <span className="flex items-baseline gap-1">
                        <span className="truncate font-medium">{p.name}</span>
                        {p.starred && <span className="text-amber-500" title={t("Starred")}>★</span>}
                      </span>
                      {p.context ? <span className="line-clamp-2 block text-xs text-zinc-500">{p.context}</span> : p.email ? <span className="block truncate text-xs text-zinc-400">{p.email}</span> : null}
                      {(p.next || p.todos > 0 || p.tickets > 0) && (
                        <span className="flex flex-wrap gap-1 pt-0.5 text-xs">
                          {p.next && <span className={`rounded px-1.5 py-0.5 ${soon ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"}`}>{p.nextKind ? `${p.nextKind} · ${day(p.next)}` : day(p.next)}</span>}
                          {p.todos > 0 && <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">{p.todos === 1 ? t("1 todo") : t("{n} todos", { n: p.todos })}</span>}
                          {p.tickets > 0 && <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{p.tickets === 1 ? t("1 ticket") : t("{n} tickets", { n: p.tickets })}</span>}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="card p-6 text-center text-sm text-zinc-400">{rows.length ? t("No one matches.") : t("No people yet — add one above, or import them from your mails and chats (Tools).")}</p>
        )}
      </div>

      <div className="min-w-0 space-y-4">
        {o.upcoming.length > 0 && (
          <Section title={t("Coming up")}>
            <ul className="space-y-1 text-sm">
              {o.upcoming.map((u) => (
                <li key={u.key} className="flex items-baseline gap-2">
                  <span className="min-w-0 flex-1 truncate">{person(u.personId, u.title)}</span>
                  <span className={`shrink-0 text-xs ${u.soon ? "font-medium text-amber-700 dark:text-amber-400" : "text-zinc-400"}`}>{u.when}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {toCheck > 0 && (
          <Section
            title={`${t("To check")} (${toCheck})`}
            aside={
              <Link href="/review" className="text-xs text-zinc-500 hover:underline">
                {t("All in the review queue")} →
              </Link>
            }
          >
            <div className="max-h-[28rem] space-y-3 overflow-y-auto pr-1">
              {o.identities.length > 0 && (
                <Group title={t("Same person?")}>
                  {o.identities.map((s) => (
                    <Item key={s.id} detail={`${s.evidence} · ${Math.round(s.confidence * 100)}%`} verdict={<Verdict onYes={() => run({ tool: "suggestion", id: s.id, accept: true }, `s${s.id}`)} onNo={() => run({ tool: "suggestion", id: s.id, accept: false }, `s${s.id}`)} />}>
                      {s.text}
                    </Item>
                  ))}
                </Group>
              )}
              {o.owed.length > 0 && (
                <Group title={t("Open commitments")}>
                  {o.owed.map((c) => (
                    <Item
                      key={c.id}
                      detail={`${c.direction === "mine" ? t("you owe") : t("they owe")}${c.due ? ` · ${c.due}` : ""}`}
                      verdict={
                        <button type="button" className="btn btn-sm" onClick={() => void run({ tool: "claim", id: c.id, action: "done" }, `c${c.id}`)}>
                          {t("Done")}
                        </button>
                      }
                    >
                      {person(c.personId, c.person)}: {c.text}
                    </Item>
                  ))}
                </Group>
              )}
              {(o.claims.length > 0 || o.links.length > 0) && (
                <Group title={t("What the AI read")}>
                  {o.claims.map((c) => (
                    <Item key={`c${c.id}`} detail={`${c.evidence ? `“${c.evidence}” · ` : ""}${Math.round(c.confidence * 100)}%`} verdict={<Verdict onYes={() => run({ tool: "claim", id: c.id, action: "confirm" }, `c${c.id}`)} onNo={() => run({ tool: "claim", id: c.id, action: "reject" }, `c${c.id}`)} />}>
                      {person(c.personId, c.person)}: {c.text}
                    </Item>
                  ))}
                  {o.links.map((l) => (
                    <Item key={`l${l.id}`} detail={l.evidence} verdict={<Verdict onYes={() => run({ tool: "link", id: l.id, action: "confirm" }, `l${l.id}`)} onNo={() => run({ tool: "link", id: l.id, action: "reject" }, `l${l.id}`)} />}>
                      {person(l.personId, l.person)}: {l.text}
                    </Item>
                  ))}
                </Group>
              )}
              {o.stale.length > 0 && (
                <Group title={t("Still true?")}>
                  {o.stale.map((c) => (
                    <Item key={c.id} verdict={<Verdict yes={t("Still true")} no={t("Outdated")} onYes={() => run({ tool: "claim", id: c.id, action: "recheck" }, `c${c.id}`)} onNo={() => run({ tool: "claim", id: c.id, action: "reject" }, `c${c.id}`)} />}>
                      {person(c.personId, c.person)}: {c.text}
                    </Item>
                  ))}
                </Group>
              )}
              {o.dates.length > 0 && (
                <Group title={t("Dates found")}>
                  {o.dates.map((d) => (
                    <Item key={d.id} detail={d.source} verdict={<Verdict onYes={() => run({ tool: "dateConfirm", id: d.id }, `d${d.id}`)} onNo={() => run({ tool: "dateDelete", id: d.id }, `d${d.id}`)} />}>
                      {person(d.personId, d.person)}: {d.text}
                    </Item>
                  ))}
                </Group>
              )}
            </div>
          </Section>
        )}

        {(o.suggestions.persons.length > 0 || o.suggestions.chats.length > 0 || o.suggestions.error) && (
          <Section title={t("Suggestions")}>
            {o.suggestions.error && <p className="text-xs text-amber-700 dark:text-amber-400">{t("Knowledge: {error}", { error: o.suggestions.error })}</p>}
            {o.suggestions.persons.length > 0 && (
              <div className="space-y-1">
                <h3 className="text-xs text-zinc-500">{t("From the knowledge — the most mentioned first")}</h3>
                <ul className="flex flex-wrap gap-1.5">
                  {o.suggestions.persons.map((k) => (
                    <li key={k.id}>
                      <button type="button" className="rounded-full border border-zinc-200 px-2 py-0.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800" title={t("{n} pages", { n: k.pages })} onClick={() => void run({ tool: "add", name: k.name, entityId: k.id, aliases: k.aliases }, `k${k.id}`)}>
                        + {k.name} <span className="text-xs text-zinc-400">{k.pages}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {o.suggestions.chats.length > 0 && (
              <div className="space-y-1">
                <h3 className="text-xs text-zinc-500">{t("From WhatsApp")}</h3>
                <ul className="flex flex-wrap gap-1.5">
                  {o.suggestions.chats.map((c) => (
                    <li key={c.name}>
                      <button type="button" className="rounded-full border border-zinc-200 px-2 py-0.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800" title={t("{n} messages", { n: c.messages })} onClick={() => void run({ tool: "add", name: c.name, whatsapp: c.name }, `w${c.name}`)}>
                        + {c.name}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Section>
        )}

        <details className="card group p-4" open={running || undefined}>
          <summary className="cursor-pointer text-xs font-semibold text-zinc-500 uppercase select-none">{t("Tools")}</summary>
          <div className="mt-3 flex flex-col gap-2">
            {tool("import", t("Import from context (AI)"), { tool: "import" }, t("The AI goes through the last 14 days of your mails, WhatsApp and Teams and makes profiles of the people in them."), true)}
            {o.progress.dates ? (
              <p className="text-sm text-zinc-500">
                <span className="mr-2 inline-block size-2 animate-pulse rounded-full bg-amber-500" />
                {t("Searching dates… {done} of {total} · {found} found", o.progress.dates)}
              </p>
            ) : (
              tool("findAll", t("Find dates for everyone"), { tool: "findAll" }, t("For everyone without a birthday: in the facts and (with the LLM plugin) by AI in the knowledge and the messages"))
            )}
            {o.count > 1 && tool("normalize", t("Match names (AI)"), { tool: "normalize" }, t("The AI looks at who the names in your todos are: new names become aliases, contacts get profiles, duplicates are merged. It also runs after each briefing."))}
            {o.count > 0 && (
              <div className="flex gap-1">
                <button type="button" className="btn btn-sm min-w-0 flex-1" disabled={busy !== null} title={t("The AI reads the messages that came in since the last time (mail, chats, Teams, Jira) and notes what they say about people: roles, responsibilities, facts, commitments — to confirm.")} onClick={() => void run({ tool: "extract", days: Number(days) }, "extract")}>
                  {busy === "extract" ? "…" : t("Read new messages (AI)")}
                </button>
                <select className="input w-24 text-xs" value={days} onChange={(e) => setDays(e.target.value)} aria-label={t("Look back")}>
                  <option value="0">{t("since last")}</option>
                  <option value="14">{t("14 days")}</option>
                  <option value="30">{t("30 days")}</option>
                </select>
              </div>
            )}
            {o.count > 0 && tool("linkJira", t("Link Jira accounts"), { tool: "linkJira" }, t("Ties Jira users to the profiles by their names — so @-mentions in notes synced to Jira point to the right person. No AI."))}
            {o.progress.compile ? (
              <p className="text-sm text-zinc-500">
                <span className="mr-2 inline-block size-2 animate-pulse rounded-full bg-indigo-500" />
                {t("Compiling … {done} of {total}", { done: o.progress.compile.done, total: o.progress.compile.total })}
                {o.progress.compile.current ? ` · ${o.progress.compile.current}` : ""}
              </p>
            ) : (
              <div className="flex gap-1">
                {tool("compile", t("Compile summaries"), { tool: "compile" }, t("A summary of every person: what connects you, the key facts, the fun facts"))}
                {tool("compileAgain", t("again"), { tool: "compile", force: true }, t("Also those compiled in the last 12 hours"))}
              </div>
            )}
            <p className="text-xs text-zinc-400">{t("Two profiles that are one person? Open one: “Merge or delete” merges it into the other.")}</p>
          </div>
        </details>
      </div>
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <h3 className="text-xs text-zinc-500">{title}</h3>
      <ul className="space-y-2">{children}</ul>
    </div>
  );
}

/** One thing to check: what it says, where it's from (small), the buttons under it — fits the narrow column. */
function Item({ children, detail, verdict }: { children: ReactNode; detail?: string; verdict: ReactNode }) {
  return (
    <li className="space-y-1 text-sm">
      <p className="min-w-0">{children}</p>
      {detail && (
        <p className="truncate text-xs text-zinc-500" title={detail}>
          {detail}
        </p>
      )}
      {verdict}
    </li>
  );
}

function Verdict({ onYes, onNo, yes, no }: { onYes: () => unknown; onNo: () => unknown; yes?: string; no?: string }) {
  const t = useT();
  return (
    <span className="flex shrink-0 gap-1">
      <button type="button" className="btn btn-primary btn-sm" onClick={() => void onYes()}>
        {yes ?? t("Right")}
      </button>
      <button type="button" className="btn btn-sm" onClick={() => void onNo()}>
        {no ?? t("Wrong")}
      </button>
    </span>
  );
}
