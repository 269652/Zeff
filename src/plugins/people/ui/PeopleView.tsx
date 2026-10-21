"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import type { Row } from "@/plugins/workspace/model";
import type { AppViewProps } from "@/plugins/workspace/ui/app-view";
import { peopleOverviewAction, peopleToolAction } from "../block-actions";
import { CIRCLES, circleLabels, type Circle } from "../shared";
import type { PeopleOverview, PeopleTool } from "../tools";
import { Meetings, Nudges } from "./PeoplePulse";
import { PersonCard, type CardPerson } from "./PersonCard";

/**
 * The people database's overview: the people themselves — cards by circle, to filter and sort (the database's search narrows
 * them), each with when you were last in touch, what is open between you, the next date, the todos and what to do — beside the
 * appointments with them coming up (a brief each), who to get in touch with, the dates coming up and what to check. The tools
 * (import, find dates, match names, read messages, link Jira, compile) and the settings fold away.
 */

/** The people source's fixed field ids (workspace-source.ts). */
const F = { starred: "peoplestar", next: "peoplenext", nextKind: "peoplenextkind", context: "peoplecontext", todos: "peopletodos", tickets: "peopletickets" };

type Only = "" | "starred" | "todos" | "owed" | "soon" | "quiet";
type Sort = "name" | "quiet" | "recent" | "next" | "todos";

/** A row as the card needs it. */
function personOf(r: Row): CardPerson {
  const text = (id: string) => String(r.cells[id] ?? "").trim();
  const count = (id: string) => (text(id) ? text(id).split(" · ").length : 0);
  const ref = /^person:(\d+)$/.exec(String(r.cells.srcref ?? ""));
  return { id: r.id, personId: ref ? Number(ref[1]) : null, name: r.title || "—", starred: r.cells[F.starred] === true, next: text(F.next) || null, nextKind: text(F.nextKind), context: text(F.context), todos: count(F.todos), tickets: text(F.tickets) ? text(F.tickets).split(/,\s*/).length : 0 };
}

function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="card space-y-3 p-4">
      <div className="flex items-baseline gap-2">
        <h2 className="flex-1 text-sm font-semibold text-zinc-800 dark:text-zinc-200">{title}</h2>
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
  const [adding, setAdding] = useState(false);
  const [days, setDays] = useState("0");
  const [circle, setCircle] = useState<Circle | "" | "none">("");
  const [only, setOnly] = useState<Only>("");
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

  // "Now" and "soon" (today to 30 days ahead) — fixed when the view opens.
  const [[now, today, in30]] = useState(() => [Date.now(), new Date().toISOString().slice(0, 10), new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10)] as const);
  const cards = o?.cards;
  const weeks = o?.settings.weeks ?? 6;
  const all = useMemo(() => rows.map(personOf), [rows]);
  const people = useMemo(() => {
    const info = (p: CardPerson) => (p.personId ? cards?.[p.personId] : undefined);
    const last = (p: CardPerson) => info(p)?.lastContact?.at ?? "";
    const cared = (p: CardPerson) => p.starred || info(p)?.circle === "family" || info(p)?.circle === "friends";
    const list = all
      .filter((p) => (circle === "" ? true : circle === "none" ? !info(p)?.circle : info(p)?.circle === circle))
      .filter((p) => {
        if (only === "starred") return p.starred;
        if (only === "todos") return p.todos > 0;
        if (only === "owed") return (info(p)?.owed.length ?? 0) > 0;
        if (only === "soon") return !!p.next && p.next >= today && p.next <= in30;
        if (only === "quiet") return cared(p) && !!last(p) && now - Date.parse(last(p)) >= weeks * 7 * 864e5;
        return true;
      });
    const byName = (a: CardPerson, b: CardPerson) => a.name.localeCompare(b.name, "de");
    const cmp: Record<Sort, (a: CardPerson, b: CardPerson) => number> = {
      name: (a, b) => Number(b.starred) - Number(a.starred) || byName(a, b),
      // The longest without contact first; never in touch at the end.
      quiet: (a, b) => (last(a) || "9999").localeCompare(last(b) || "9999") || byName(a, b),
      recent: (a, b) => last(b).localeCompare(last(a)) || byName(a, b),
      next: (a, b) => (a.next ?? "9999").localeCompare(b.next ?? "9999") || byName(a, b),
      todos: (a, b) => b.todos - a.todos || byName(a, b),
    };
    return list.sort(cmp[sort]);
  }, [all, cards, circle, only, sort, today, in30, now, weeks]);

  const run = async (tool: PeopleTool, key: string): Promise<{ ok: boolean; draft?: string }> => {
    setBusy(key);
    const r = await peopleToolAction(tool);
    setBusy(null);
    if (!r.ok) toast(r.error, { tone: "error" });
    else if (r.message) toast(r.message);
    // A greeting drafted changes nothing to read again.
    if (tool.tool !== "greeting") {
      await load();
      router.refresh();
    }
    return r.ok ? { ok: true, draft: r.draft } : { ok: false };
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
  // How many kinds there are to check: just one — it is open.
  const kinds = [o.identities.length, o.owed.length, o.claims.length + o.links.length, o.stale.length, o.dates.length].filter((n) => n > 0).length;
  const labels = circleLabels(t);
  const inCircle = (c: Circle | "none") => all.filter((p) => (p.personId ? (c === "none" ? !o.cards[p.personId]?.circle : o.cards[p.personId]?.circle === c) : false)).length;
  const none = inCircle("none");
  const circles: { id: Circle | "" | "none"; label: string; n: number }[] = [
    { id: "", label: t("All"), n: all.length },
    ...CIRCLES.map((c) => ({ id: c, label: labels[c], n: inCircle(c) })).filter((c) => c.n > 0),
    ...(none && none < all.length ? [{ id: "none" as const, label: t("No circle"), n: none }] : []),
  ];
  const onlies: { id: Only; label: string }[] = [
    { id: "starred", label: `★ ${t("Starred")}` },
    { id: "quiet", label: t("Long not heard of") },
    { id: "owed", label: t("Open promises") },
    { id: "todos", label: t("With todos") },
    { id: "soon", label: t("Dates soon") },
  ];

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]" data-app-view="people">
      <div className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex flex-wrap items-center gap-0.5 rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-800/70" role="group" aria-label={t("Circle")}>
            {circles.map((c) => (
              <button
                key={c.id || "all"}
                type="button"
                aria-pressed={circle === c.id}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-sm font-medium transition ${circle === c.id ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-950 dark:text-zinc-100" : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"}`}
                onClick={() => setCircle(c.id)}
              >
                {c.label}
                <span className="text-xs text-zinc-400 tabular-nums">{c.n}</span>
              </button>
            ))}
          </div>
          <span className="flex-1" />
          <select className="input w-auto py-1 text-sm" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label={t("Sort")}>
            <option value="name">{t("By name")}</option>
            <option value="quiet">{t("Longest without contact first")}</option>
            <option value="recent">{t("Last in touch first")}</option>
            <option value="next">{t("Next date first")}</option>
            <option value="todos">{t("Most todos first")}</option>
          </select>
          {adding ? (
            <form
              className="flex gap-1"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!name.trim()) return;
                await run({ tool: "add", name }, "add");
                setName("");
                setAdding(false);
              }}
            >
              <input className="input w-44 py-1 text-sm" autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setAdding(false)} placeholder={t("Name…")} aria-label={t("New person")} />
              <button className="btn btn-primary btn-sm" disabled={busy !== null || !name.trim()}>
                {t("Add")}
              </button>
            </form>
          ) : (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setAdding(true)}>
              + {t("Person")}
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="text-xs text-zinc-500 tabular-nums">
            {people.length === rows.length ? (o.count === 1 ? t("1 person") : t("{n} people", { n: o.count })) : t("{n} of {total}", { n: people.length, total: rows.length })}
          </span>
          <span className="h-3 w-px bg-zinc-200 dark:bg-zinc-700" aria-hidden />
          <div className="flex flex-wrap gap-1" role="group" aria-label={t("Filter")}>
            {onlies.map((f) => (
              <button
                key={f.id}
                type="button"
                aria-pressed={only === f.id}
                className={`rounded-full px-2.5 py-0.5 text-xs ring-1 ring-inset transition ${only === f.id ? "bg-zinc-900 text-white ring-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 dark:ring-zinc-100" : "text-zinc-600 ring-zinc-200 hover:ring-zinc-300 dark:text-zinc-300 dark:ring-zinc-700"}`}
                onClick={() => setOnly(only === f.id ? "" : f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {people.length ? (
          <ul className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-3">
            {people.map((p) => (
              <li key={p.id}>
                <PersonCard p={p} info={p.personId ? o.cards[p.personId] : undefined} now={now} soonUntil={in30} weeks={weeks} open={() => openRow(p.id)} run={run} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="card p-6 text-center text-sm text-zinc-400">{rows.length ? t("No one matches.") : t("No people yet — add one above, or import them from your mails and chats (Tools).")}</p>
        )}
      </div>

      <div className="min-w-0 space-y-4">
        {o.meetings.length > 0 && (
          <Section title={t("Appointments in the next 24 hours")}>
            <Meetings meetings={o.meetings} person={person} now={now} />
          </Section>
        )}

        {o.nudges.length > 0 && (
          <Section title={t("Get in touch again?")} aside={<span className="text-xs text-zinc-400">{t("after {n} weeks", { n: weeks })}</span>}>
            <Nudges nudges={o.nudges} cards={o.cards} person={person} run={run} busy={busy !== null} />
          </Section>
        )}

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
            title={t("To check")}
            aside={
              <Link href="/review" className="text-xs text-zinc-500 hover:text-zinc-800 hover:underline dark:hover:text-zinc-200">
                {t("{n} in the review queue", { n: toCheck })} →
              </Link>
            }
          >
            {o.confident > 0 && (
              <button type="button" className="btn btn-sm w-full" disabled={busy !== null} title={t("Claims and links the AI is sure of (90 % and more) — identity suggestions still wait for you.")} onClick={() => void run({ tool: "acceptConfident" }, "confident")}>
                {busy === "confident" ? "…" : t("Take all from 90 % ({n})", { n: o.confident })}
              </button>
            )}
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {o.identities.length > 0 && (
                <Group title={t("Same person?")} n={o.identities.length} open={kinds === 1}>
                  {o.identities.map((s) => (
                    <Item key={s.id} detail={`${s.evidence} · ${Math.round(s.confidence * 100)}%`} verdict={<Verdict onYes={() => run({ tool: "suggestion", id: s.id, accept: true }, `s${s.id}`)} onNo={() => run({ tool: "suggestion", id: s.id, accept: false }, `s${s.id}`)} />}>
                      {s.text}
                    </Item>
                  ))}
                </Group>
              )}
              {o.owed.length > 0 && (
                <Group title={t("Open commitments")} n={o.owed.length} open={kinds === 1}>
                  {o.owed.map((c) => (
                    <Item
                      key={c.id}
                      detail={`${c.direction === "mine" ? t("you owe") : t("they owe")}${c.due ? ` · ${c.due}` : ""}`}
                      verdict={<Verdict yes={t("Done")} onYes={() => run({ tool: "claim", id: c.id, action: "done" }, `c${c.id}`)} />}
                    >
                      {person(c.personId, c.person)}: {c.text}
                    </Item>
                  ))}
                </Group>
              )}
              {(o.claims.length > 0 || o.links.length > 0) && (
                <Group title={t("What the AI read")} n={o.claims.length + o.links.length} open={kinds === 1}>
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
                <Group title={t("Still true?")} n={o.stale.length} open={kinds === 1}>
                  {o.stale.map((c) => (
                    <Item key={c.id} verdict={<Verdict yes={t("Still true")} no={t("Outdated")} onYes={() => run({ tool: "claim", id: c.id, action: "recheck" }, `c${c.id}`)} onNo={() => run({ tool: "claim", id: c.id, action: "reject" }, `c${c.id}`)} />}>
                      {person(c.personId, c.person)}: {c.text}
                    </Item>
                  ))}
                </Group>
              )}
              {o.dates.length > 0 && (
                <Group title={t("Dates found")} n={o.dates.length} open={kinds === 1}>
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
          <details className="card group p-4">
            <summary className="flex cursor-pointer list-none items-baseline gap-2 text-sm font-semibold text-zinc-800 select-none dark:text-zinc-200">
              <span className="flex-1">{t("Suggestions")}</span>
              <span className="text-xs font-normal text-zinc-400">{t("{n} to take over", { n: o.suggestions.persons.length + o.suggestions.chats.length })}</span>
              <span className="text-zinc-400 transition group-open:rotate-90" aria-hidden>›</span>
            </summary>
            <div className="mt-3 space-y-3">
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
            </div>
          </details>
        )}

        <details className="card group p-4" open={running || undefined}>
          <summary className="flex cursor-pointer list-none items-baseline gap-2 text-sm font-semibold text-zinc-800 select-none dark:text-zinc-200">
            <span className="flex-1">{t("Tools and settings")}</span>
            <span className="text-zinc-400 transition group-open:rotate-90" aria-hidden>›</span>
          </summary>
          <div className="mt-3 grid gap-2 [&>.btn]:justify-start">
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
            {o.count > 0 && tool("classify", t("Place contacts (AI)"), { tool: "classify" }, t("The AI says for each contact not placed yet whether it is a person or an organisation and which circle it is in — from what Zeff knows of them. Yours stay. It also runs after each briefing."))}
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
            <Settings weeks={weeks} myName={o.settings.myName} save={(v) => void run({ tool: "settings", ...v }, "settings")} />
          </div>
        </details>
      </div>
    </div>
  );
}

/** A kind of thing to check: its name and count, folded (open when it is the only kind). */
function Group({ title, n, open, children }: { title: string; n: number; open?: boolean; children: ReactNode }) {
  return (
    <details className="group/g py-2 first:pt-0 last:pb-0" open={open}>
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm text-zinc-700 select-none dark:text-zinc-300">
        <span className="text-zinc-400 transition group-open/g:rotate-90" aria-hidden>›</span>
        <span className="flex-1">{title}</span>
        <span className="rounded-full bg-zinc-100 px-1.5 text-xs text-zinc-600 tabular-nums dark:bg-zinc-800 dark:text-zinc-300">{n}</span>
      </summary>
      <ul className="mt-2 max-h-80 space-y-2.5 overflow-y-auto pr-1">{children}</ul>
    </details>
  );
}

/** One thing to check: what it says, where it's from (small), the buttons under it — fits the narrow column. */
function Item({ children, detail, verdict }: { children: ReactNode; detail?: string; verdict: ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-sm">
      <div className="min-w-0 flex-1">
        <p className="line-clamp-3">{children}</p>
        {detail && (
          <p className="truncate text-xs text-zinc-500" title={detail}>
            {detail}
          </p>
        )}
      </div>
      {verdict}
    </li>
  );
}

function Verdict({ onYes, onNo, yes, no }: { onYes: () => unknown; onNo?: () => unknown; yes?: string; no?: string }) {
  const t = useT();
  const btn = "flex size-7 items-center justify-center rounded-md ring-1 ring-inset transition";
  return (
    <span className="flex shrink-0 gap-1">
      <button type="button" className={`${btn} bg-indigo-600 text-white ring-indigo-600 hover:bg-indigo-700`} title={yes ?? t("Right")} aria-label={yes ?? t("Right")} onClick={() => void onYes()}>
        <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="m3.5 8.5 3 3 6-7" />
        </svg>
      </button>
      {onNo && (
        <button type="button" className={`${btn} text-zinc-500 ring-zinc-200 hover:bg-zinc-100 hover:text-zinc-800 dark:ring-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-100`} title={no ?? t("Wrong")} aria-label={no ?? t("Wrong")} onClick={() => void onNo()}>
          <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
          </svg>
        </button>
      )}
    </span>
  );
}

/** The settings: after how many weeks someone you care about comes up, and your name (your family by your last name). */
function Settings({ weeks, myName, save }: { weeks: number; myName: string; save: (v: { weeks?: number; myName?: string }) => void }) {
  const t = useT();
  return (
    <div className="grid grid-cols-[auto_1fr] items-center gap-2 border-t border-zinc-100 pt-3 text-sm dark:border-zinc-800">
      <label htmlFor="people-weeks" className="text-xs text-zinc-500">
        {t("Remind after (weeks)")}
      </label>
      <input id="people-weeks" type="number" min={1} max={52} className="input w-20 text-sm" defaultValue={weeks} onBlur={(e) => Number(e.target.value) !== weeks && save({ weeks: Number(e.target.value) })} />
      <label htmlFor="people-me" className="text-xs text-zinc-500">
        {t("Your name")}
      </label>
      <input id="people-me" className="input text-sm" defaultValue={myName} placeholder={t("First and last name")} title={t("People with your last name count as family.")} onBlur={(e) => e.target.value.trim() !== myName && save({ myName: e.target.value })} />
    </div>
  );
}
