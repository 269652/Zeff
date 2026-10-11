import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { daysUntil, dueText, dueTone } from "@/lib/boards/due-shared";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { formatHours } from "@/lib/format";
import type { TodoView } from "@/lib/boards/shared";
import { remindedFormAction } from "@/plugins/people/server-actions";
import { inDaysText, upcomingTitle } from "@/plugins/people/shared";
import { isInstalled } from "@/plugins/state";

export const metadata: Metadata = { title: "Heute" };

const time = (iso: string) => new Date(iso).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
const ago = (iso: string, now: number) => {
  const d = Math.floor((now - new Date(iso).getTime()) / 864e5);
  return d <= 0 ? "heute" : d === 1 ? "seit gestern" : `seit ${d} Tagen`;
};

function Card({ title, href, count, children }: { title: string; href?: string; count?: number; children: React.ReactNode }) {
  return (
    <section className="card flex flex-col p-4">
      <h2 className="mb-2 flex items-baseline justify-between gap-2 text-sm font-semibold text-zinc-500 uppercase">
        <span>
          {title}
          {count !== undefined && <span className="ml-1.5 text-zinc-400 tabular-nums">{count}</span>}
        </span>
        {href && (
          <Link href={href} className="text-xs font-normal tracking-normal text-indigo-600 normal-case hover:underline dark:text-indigo-400">
            alle →
          </Link>
        )}
      </h2>
      {children}
    </section>
  );
}

const Empty = ({ children }: { children: React.ReactNode }) => <p className="text-sm text-zinc-400">{children}</p>;

/** Everything the page shows, gathered (outside the render: the clock is read here). */
async function heuteData() {
  const now = Date.now();
  const { listTodos, latestRun } = await import("@/lib/boards/store");
  const run = latestRun();
  const open = listTodos({ status: "open" });
  const mine = open.filter((t) => t.owner === "me");
  const asking = open.filter((t) => t.needsInput);
  // Workers and agents report these done: yours to look at and close.
  const reportedDone = open.filter((t) => t.workerDone && !t.needsInput);
  const due = mine.filter((t) => t.due && daysUntil(t.due) <= 3).sort((a, b) => a.due!.localeCompare(b.due!));
  const flagged = mine.filter((t) => t.flaggedAt && !(t.due && daysUntil(t.due) <= 3));
  // Waiting on others for three days or more: time to ask again.
  const waiting = open.filter((t) => t.owner === "other" && now - new Date(t.createdAt).getTime() >= 3 * 864e5).sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  // Today's meetings (Outlook's calendar).
  const today = new Date();
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  let meetings: { subject: string; start: string; end: string; online: boolean }[] = [];
  if (isInstalled("outlook-calendar")) {
    const { readInbox } = await import("@/lib/calendar/inbox");
    meetings = readInbox()
      .filter((e) => !e.isCancelled && !e.isAllDay && e.start.dateTime.slice(0, 10) === iso && e.showAs !== "free")
      .map((e) => ({ subject: e.subject ?? "(ohne Titel)", start: e.start.dateTime, end: e.end.dateTime, online: !!e.isOnlineMeeting }))
      .sort((a, b) => a.start.localeCompare(b.start));
  }

  // Messages waiting for your answer: a chat whose last message (this week) isn't yours.
  const unanswered: { key: string; who: string; text: string; at: string; since: string; count: number; href: string; source: string }[] = [];
  if (isInstalled("whatsapp")) {
    // One line per chat, while the last word isn't yours; a group only when something in it is to you.
    const { whatsappChatsWaiting } = await import("@/lib/mail/store");
    for (const c of whatsappChatsWaiting(7, now))
      unanswered.push({ key: c.key, who: c.who, text: c.text, at: c.lastAt, since: c.since, count: c.count, href: `/apps/whatsapp?chat=${encodeURIComponent(c.who)}`, source: "WhatsApp" });
  }
  if (isInstalled("teams")) {
    // One line per chat (not per message), and only while the last word isn't yours.
    const { teamsChatsWaiting } = await import("@/lib/teams/store");
    for (const c of teamsChatsWaiting(3, now)) unanswered.push({ key: c.key, who: c.who, text: c.text, at: c.lastAt, since: c.since, count: c.count, href: c.link || "/teams", source: "Teams" });
  }
  unanswered.sort((a, b) => b.at.localeCompare(a.at));

  // Today's hours against the target, and suggestions waiting.
  let hours: { booked: number; target: number; suggestions: number } | null = null;
  if (isInstalled("zeiterfassung")) {
    const { listEntries } = await import("@/lib/entries");
    const { getDayTargets } = await import("@/lib/schedule");
    const { openSuggestionTotals } = await import("@/lib/work/suggestions");
    hours = {
      booked: listEntries({ from: iso, to: iso }).reduce((s, e) => s + e.hours, 0),
      target: getDayTargets([today])[0]?.target ?? 0,
      suggestions: openSuggestionTotals(iso, iso).count,
    };
  }

  // Syncs that keep failing — a driver whose page changed, a sign-in that ran out.
  const { syncOverview } = await import("@/lib/sync/registry");
  const { syncProblems } = await import("@/lib/sync/health");
  const problems = syncProblems(syncOverview().steps, now);

  // Birthdays and other dates of your people, inside their reminder (Personen plugin).
  let reminders: import("@/plugins/people/shared").Upcoming[] = [];
  if (isInstalled("people")) {
    const { upcoming } = await import("@/plugins/people/store");
    reminders = upcoming({ withinReminder: true });
  }

  // Weeks to close: this one on its last working day, last week until Wednesday — while steps are left.
  const weeks: { key: string; title: string; open: number; href: string }[] = [];
  if (isInstalled("zeiterfassung")) {
    const { currentWeek, shiftWeek } = await import("@/lib/week");
    const { weekClose } = await import("@/lib/week-close");
    const thisWeek = currentWeek();
    const candidates = today.getDay() >= 1 && today.getDay() <= 3 ? [{ w: shiftWeek(thisWeek, -1), title: "Letzte Woche abschließen" }] : [];
    candidates.push({ w: thisWeek, title: "Woche abschließen" });
    for (const { w, title } of candidates) {
      const c = await weekClose(w, today);
      if (c.over && !c.done) weeks.push({ key: w.key, title: `${title} (KW ${w.week})`, open: c.items.filter((i) => i.state !== "ok").length, href: `/?week=${w.key}` });
    }
  }

  // What's next, across all of it — ranked.
  const { nextUp } = await import("@/lib/heute-next");
  const { upcomingTitle } = await import("@/plugins/people/shared");
  const next = nextUp({
    now,
    asking,
    mine,
    meetings,
    unanswered,
    dates: reminders.map((r) => ({ key: `${r.date.id}:${r.on}`, title: upcomingTitle(r), inDays: r.inDays, href: `/personen/${r.person.id}` })),
    hours,
    weeks,
  });

  return { run, open, mine, asking, reportedDone, due, flagged, waiting, meetings, unanswered, hours, problems, reminders, next, today, now };
}

const NEXT_TONE: Record<import("@/lib/heute-next").NextTone, string> = {
  red: "font-medium text-red-600 dark:text-red-400",
  amber: "text-amber-600 dark:text-amber-400",
  indigo: "text-indigo-600 dark:text-indigo-400",
  zinc: "text-zinc-500",
};

const PROBLEM: Record<"login" | "chrome" | "broken", string> = {
  login: "Anmeldung nötig",
  chrome: "Automations-Chrome läuft nicht",
  broken: "schlägt fehl",
};

/**
 * Heute: the day on one page — what the Lage says, what's due, what agents ask, today's meetings,
 * messages waiting for your answer, who you're waiting on, and today's hours against the target.
 * Each part only with its plugin.
 */
export default async function HeutePage() {
  await connection();
  if (!isInstalled("todos")) return <PluginNotInstalled id="todos" />;
  const { run, mine, asking, reportedDone, due, flagged, waiting, meetings, unanswered, hours, problems, reminders, next, today, now } = await heuteData();

  const todo = (t: TodoView, extra?: React.ReactNode) => (
    <li key={t.id} className="flex items-baseline gap-2 text-sm">
      <Link href={`/t/${t.id}`} className="font-mono text-xs text-zinc-400 hover:underline">
        {t.ref}
      </Link>
      <span className="min-w-0 flex-1">{t.text}</span>
      {extra}
    </li>
  );

  return (
    <div className="page">
      <div className="page-aside">
        <h1 className="text-lg font-semibold">Heute</h1>
        <p className="text-sm text-zinc-500">{today.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" })}</p>
        {run?.result?.lede && (
          <div className="space-y-1">
            <p className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">{run.result.lede}</p>
            <Link href="/todos" className="text-xs text-indigo-600 hover:underline dark:text-indigo-400">
              Zur Lage →
            </Link>
          </div>
        )}
        {hours && (
          <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
            <div className="text-xs text-zinc-500 uppercase">Stunden heute</div>
            <div className="text-2xl font-semibold tabular-nums">
              {formatHours(hours.booked)} <span className="text-base font-normal text-zinc-400">/ {formatHours(hours.target)}</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded bg-zinc-200 dark:bg-zinc-800">
              <div className="h-full bg-indigo-500" style={{ width: `${Math.min(100, hours.target ? (hours.booked / hours.target) * 100 : 0)}%` }} />
            </div>
            <Link href="/feierabend" className="mt-1 block text-xs text-indigo-600 hover:underline dark:text-indigo-400">
              {hours.suggestions ? `${hours.suggestions} Vorschläge von heute — Tag buchen →` : "Tag buchen (Feierabend) →"}
            </Link>
          </div>
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {next.length > 0 && (
          <section className="card p-4 xl:col-span-2">
            <h2 className="mb-2 text-sm font-semibold text-zinc-500 uppercase">Als Nächstes</h2>
            <ol className="space-y-1.5">
              {next.map((n, i) => {
                const body = (
                  <>
                    <span className="w-4 shrink-0 text-right text-xs text-zinc-400 tabular-nums">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate">{n.title}</span>
                    <span className={`shrink-0 text-xs ${NEXT_TONE[n.tone]}`}>{n.detail}</span>
                  </>
                );
                return (
                  <li key={n.key} className="text-sm">
                    {n.href ? (
                      <a href={n.href} className="flex items-baseline gap-2 hover:underline" {...(n.href.startsWith("http") ? { target: "_blank", rel: "noreferrer" } : {})}>
                        {body}
                      </a>
                    ) : (
                      <div className="flex items-baseline gap-2">{body}</div>
                    )}
                  </li>
                );
              })}
            </ol>
          </section>
        )}

        {problems.length > 0 && (
          <Card title="Syncs mit Problemen" count={problems.length}>
            <ul className="space-y-1.5">
              {problems.map((p) => (
                <li key={p.key} className="text-sm">
                  <div className="flex items-baseline gap-2">
                    <Link href={p.kind === "login" ? "/logins" : p.href} className="shrink-0 font-medium hover:underline">
                      {p.label}
                    </Link>
                    <span className="min-w-0 flex-1 text-red-600 dark:text-red-400">{PROBLEM[p.kind]}</span>
                    <span className="shrink-0 text-xs text-zinc-400">
                      {p.failures}× · {ago(p.since, now)}
                    </span>
                  </div>
                  {p.message && <p className="truncate text-xs text-zinc-500" title={p.message}>{p.message}</p>}
                </li>
              ))}
            </ul>
          </Card>
        )}

        {reportedDone.length > 0 && (
          <Card title="Von Workern erledigt gemeldet" count={reportedDone.length} href="/todos">
            <ul className="space-y-1.5">{reportedDone.map((t) => todo(t, <span className="shrink-0 text-xs text-emerald-600 dark:text-emerald-400">✓</span>))}</ul>
          </Card>
        )}
        {asking.length > 0 && (
          <Card title="Agenten fragen dich" count={asking.length}>
            <ul className="space-y-1.5">{asking.map((t) => todo(t, <span className="shrink-0 text-xs text-amber-600 dark:text-amber-400">❗</span>))}</ul>
          </Card>
        )}

        {reminders.length > 0 && (
          <Card title="Erinnerungen" count={reminders.length} href="/personen">
            <ul className="space-y-1.5">
              {reminders.map((r) => (
                <li key={`${r.date.id}:${r.on}`} className="flex items-baseline gap-2 text-sm">
                  <span className="shrink-0">{r.date.kind === "birthday" ? "🎂" : "📅"}</span>
                  <Link href={`/personen/${r.person.id}`} className="min-w-0 flex-1 hover:underline">
                    {upcomingTitle(r)}
                  </Link>
                  <span className={`shrink-0 text-xs ${r.inDays === 0 ? "font-medium text-amber-700 dark:text-amber-400" : "text-zinc-500"}`}>{inDaysText(r.inDays, r.on)}</span>
                  <form action={remindedFormAction} className="shrink-0">
                    <input type="hidden" name="dateId" value={r.date.id} />
                    <input type="hidden" name="on" value={r.on} />
                    <button className="text-xs text-zinc-400 hover:text-zinc-700 hover:underline dark:hover:text-zinc-200" title="Erledigt — bis zum nächsten Mal nicht mehr zeigen">
                      erledigt
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <Card title="Fällig" count={due.length + flagged.length} href="/todos">
          {due.length || flagged.length ? (
            <ul className="space-y-1.5">
              {due.map((t) => todo(t, <span className={`shrink-0 text-xs ${dueTone(t.due!)}`}>{dueText(t.due!)}</span>))}
              {flagged.map((t) => todo(t, <span className="shrink-0 text-xs text-red-600 dark:text-red-400">wichtig</span>))}
            </ul>
          ) : (
            <Empty>Nichts fällig in den nächsten drei Tagen. {mine.length} Todos offen.</Empty>
          )}
        </Card>

        {isInstalled("outlook-calendar") && (
          <Card title="Termine" count={meetings.length} href="/calendar">
            {meetings.length ? (
              <ul className="space-y-1.5">
                {meetings.map((m, i) => {
                  const live = now >= new Date(m.start).getTime() && now < new Date(m.end).getTime();
                  return (
                    <li key={i} className={`flex items-baseline gap-2 text-sm ${new Date(m.end).getTime() < now ? "text-zinc-400" : ""}`}>
                      <span className="w-24 shrink-0 text-xs text-zinc-500 tabular-nums">
                        {time(m.start)}–{time(m.end)}
                      </span>
                      <span className={`min-w-0 flex-1 ${live ? "font-medium" : ""}`}>{m.subject}</span>
                      {live && <span className="shrink-0 text-xs text-emerald-600 dark:text-emerald-400">läuft</span>}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <Empty>Heute keine Termine.</Empty>
            )}
          </Card>
        )}

        {(isInstalled("whatsapp") || isInstalled("teams")) && (
          <Card title="Wartet auf deine Antwort" count={unanswered.length} href="/mail">
            {unanswered.length ? (
              <ul className="space-y-1.5">
                {unanswered.slice(0, 12).map((u) => (
                  <li key={u.key} className="text-sm">
                    <a href={u.href} className="flex items-baseline gap-2 hover:underline" {...(u.href.startsWith("http") ? { target: "_blank", rel: "noreferrer" } : {})}>
                      <span className="shrink-0 font-medium">{u.who}</span>
                      <span className="min-w-0 flex-1 truncate text-zinc-500">{u.text}</span>
                      <span className="shrink-0 text-xs text-zinc-400">
                        {u.count > 1 ? `${u.count} Nachrichten · ` : ""}
                        {u.source} · {ago(u.since, now)}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>Niemand wartet auf dich.</Empty>
            )}
          </Card>
        )}

        <Card title="Du wartest auf andere" count={waiting.length} href="/todos">
          {waiting.length ? (
            <ul className="space-y-1.5">{waiting.slice(0, 10).map((t) => todo(t, <span className="shrink-0 text-xs text-zinc-400">⏳ {ago(t.createdAt, now)}</span>))}</ul>
          ) : (
            <Empty>Nichts hängt länger als drei Tage.</Empty>
          )}
        </Card>
      </div>
    </div>
  );
}
