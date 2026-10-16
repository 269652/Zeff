"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import type { AppViewProps } from "@/plugins/workspace/ui/app-view";
import { peopleOverviewAction, peopleToolAction } from "../block-actions";
import type { PeopleOverview, PeopleTool } from "../tools";

/**
 * The people database's overview: what comes up (dates), what to check (names that may be one person, what the AI read, dates it
 * found), the tools (import, find dates, match names, read messages, link Jira, compile) and who to take over (from the
 * knowledge and WhatsApp). The people themselves are rows — in the other views of the database.
 */

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card space-y-2 p-4">
      <h2 className="text-xs font-semibold text-zinc-500 uppercase">{title}</h2>
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
  const load = useCallback(async () => {
    const r = await peopleOverviewAction();
    if (r.ok) setO(r.overview);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  // Running things (finding dates, compiling) go on in the background: look again until they are done.
  const running = !!o?.progress.dates || !!o?.progress.compile;
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => void load(), 4000);
    return () => clearInterval(id);
  }, [running, load]);

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
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]" data-app-view="people">
      <div className="space-y-4">
        <Section title={t("People")}>
          <form
            className="flex gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!name.trim()) return;
              await run({ tool: "add", name }, "add");
              setName("");
            }}
          >
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("Name…")} aria-label={t("New person")} />
            <button className="btn btn-primary" disabled={busy !== null}>
              {t("Add")}
            </button>
          </form>
          <p className="text-sm text-zinc-500">{o.count === 1 ? t("1 person") : t("{n} people", { n: o.count })}</p>
          <div className="flex flex-col gap-2">
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
          </div>
          <p className="text-xs text-zinc-400">{t("Two profiles that are one person? Open one: “Merge or delete” merges it into the other.")}</p>
        </Section>
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
      </div>

      <div className="space-y-4">
        {o.identities.length > 0 && (
          <Section title={t("Same person? — please check")}>
            <ul className="space-y-2">
              {o.identities.map((s) => (
                <li key={s.id} className="flex flex-wrap items-baseline gap-2 text-sm">
                  <span className="min-w-0">{s.text}</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-zinc-500" title={s.evidence}>
                    {s.evidence} · {Math.round(s.confidence * 100)}%
                  </span>
                  <Verdict onYes={() => run({ tool: "suggestion", id: s.id, accept: true }, `s${s.id}`)} onNo={() => run({ tool: "suggestion", id: s.id, accept: false }, `s${s.id}`)} />
                </li>
              ))}
            </ul>
          </Section>
        )}

        {(o.claims.length > 0 || o.links.length > 0 || o.stale.length > 0 || o.owed.length > 0) && (
          <Section title={t("What the AI read — please check")}>
            {o.owed.length > 0 && (
              <div className="space-y-1">
                <h3 className="text-xs text-zinc-500">{t("Open commitments")}</h3>
                <ul className="space-y-1 text-sm">
                  {o.owed.map((c) => (
                    <li key={c.id} className="flex flex-wrap items-baseline gap-2">
                      {person(c.personId, c.person)}
                      <span className="text-xs text-zinc-400">{c.direction === "mine" ? t("you owe") : t("they owe")}</span>
                      <span className="min-w-0 flex-1">
                        {c.text}
                        {c.due ? ` · ${c.due}` : ""}
                      </span>
                      <button type="button" className="btn btn-sm" onClick={() => void run({ tool: "claim", id: c.id, action: "done" }, `c${c.id}`)}>
                        {t("Done")}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {o.claims.length > 0 && (
              <ul className="space-y-1.5 text-sm">
                {o.claims.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-baseline gap-2">
                    {person(c.personId, c.person)}
                    <span className="min-w-0">{c.text}</span>
                    <span className="min-w-0 flex-1 truncate text-xs text-zinc-500" title={c.evidence}>
                      {c.evidence && <>“{c.evidence}” · </>}
                      {Math.round(c.confidence * 100)}%
                    </span>
                    <Verdict onYes={() => run({ tool: "claim", id: c.id, action: "confirm" }, `c${c.id}`)} onNo={() => run({ tool: "claim", id: c.id, action: "reject" }, `c${c.id}`)} />
                  </li>
                ))}
              </ul>
            )}
            {o.links.length > 0 && (
              <ul className="space-y-1.5 text-sm">
                {o.links.map((l) => (
                  <li key={l.id} className="flex flex-wrap items-baseline gap-2">
                    {person(l.personId, l.person)}
                    <span className="min-w-0">{l.text}</span>
                    <span className="min-w-0 flex-1 truncate text-xs text-zinc-500" title={l.evidence}>
                      {l.evidence}
                    </span>
                    <Verdict onYes={() => run({ tool: "link", id: l.id, action: "confirm" }, `l${l.id}`)} onNo={() => run({ tool: "link", id: l.id, action: "reject" }, `l${l.id}`)} />
                  </li>
                ))}
              </ul>
            )}
            {o.stale.length > 0 && (
              <div className="space-y-1">
                <h3 className="text-xs text-zinc-500">{t("Still true?")}</h3>
                <ul className="space-y-1 text-sm">
                  {o.stale.map((c) => (
                    <li key={c.id} className="flex flex-wrap items-baseline gap-2">
                      {person(c.personId, c.person)}
                      <span className="min-w-0 flex-1">{c.text}</span>
                      <Verdict yes={t("Still true")} no={t("Outdated")} onYes={() => run({ tool: "claim", id: c.id, action: "recheck" }, `c${c.id}`)} onNo={() => run({ tool: "claim", id: c.id, action: "reject" }, `c${c.id}`)} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Section>
        )}

        {o.dates.length > 0 && (
          <Section title={t("Dates found — are they right?")}>
            <ul className="space-y-2">
              {o.dates.map((d) => (
                <li key={d.id} className="flex flex-wrap items-baseline gap-2 text-sm">
                  {person(d.personId, d.person)}
                  <span>{d.text}</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-zinc-500" title={d.source}>
                    {d.source}
                  </span>
                  <Verdict onYes={() => run({ tool: "dateConfirm", id: d.id }, `d${d.id}`)} onNo={() => run({ tool: "dateDelete", id: d.id }, `d${d.id}`)} />
                </li>
              ))}
            </ul>
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

        {!o.identities.length && !o.claims.length && !o.dates.length && !o.suggestions.persons.length && !o.suggestions.chats.length && !o.upcoming.length && (
          <p className="text-sm text-zinc-400">{t("Nothing to check right now. The people are the rows of this database — the other views list them.")}</p>
        )}
      </div>
    </div>
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
