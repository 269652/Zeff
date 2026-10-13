import { EmptyState } from "@/components/EmptyState";
import type { Metadata } from "next";
import { t } from "@/lib/i18n/server";
import Link from "next/link";
import { connection } from "next/server";
import { daysUntil, dueText, dueTone } from "@/lib/boards/due-shared";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { formatHours, formatLongDay, formatTime } from "@/lib/format";
import type { TodoView } from "@/lib/boards/shared";
import { remindedFormAction } from "@/plugins/people/server-actions";
import { inDaysText, upcomingTitle } from "@/plugins/people/shared";
import { isInstalled } from "@/plugins/state";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Today") };
}

const ago = (iso: string, now: number) => {
  const d = Math.floor((now - new Date(iso).getTime()) / 864e5);
  return d <= 0 ? t("today") : d === 1 ? t("since yesterday") : t("for {n} days", { n: d });
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
            {t("all →")}
          </Link>
        )}
      </h2>
      {children}
    </section>
  );
}


/** Everything the page shows, gathered (outside the render: the clock is read here). */
async function heuteData() {
  const now = Date.now();
  const { listTodos, latestRun } = await import("@/lib/boards/store");
  const run = latestRun();
  const open = listTodos({ status: "open" });
  const mine = open.filter((x) => x.owner === "me" && !x.byWorker);
  const asking = open.filter((x) => x.needsInput);
  // Workers and agents report these done: yours to look at and close.
  const reportedDone = open.filter((x) => x.workerDone && !x.needsInput);
  const due = mine.filter((x) => x.due && daysUntil(x.due) <= 3).sort((a, b) => a.due!.localeCompare(b.due!));
  const flagged = mine.filter((x) => x.flaggedAt && !(x.due && daysUntil(x.due) <= 3));
  // Waiting on others for three days or more: time to ask again.
  const waiting = open.filter((x) => x.owner === "other" && now - new Date(x.createdAt).getTime() >= 3 * 864e5).sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  // Today's meetings (Outlook's calendar).
  const today = new Date();
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  let meetings: { subject: string; start: string; end: string; online: boolean }[] = [];
  if (isInstalled("outlook-calendar")) {
    const { readInbox } = await import("@/lib/calendar/inbox");
    meetings = readInbox()
      .filter((e) => !e.isCancelled && !e.isAllDay && e.start.dateTime.slice(0, 10) === iso && e.showAs !== "free")
      .map((e) => ({ subject: e.subject ?? t("(no title)"), start: e.start.dateTime, end: e.end.dateTime, online: !!e.isOnlineMeeting }))
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
  if (isInstalled("signal")) {
    const { chatsWaiting } = await import("@/lib/mail/store");
    for (const c of chatsWaiting("Signal", 7, now))
      unanswered.push({ key: c.key, who: c.who, text: c.text, at: c.lastAt, since: c.since, count: c.count, href: `/apps/signal?chat=${encodeURIComponent(c.who)}`, source: "Signal" });
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
    const candidates = today.getDay() >= 1 && today.getDay() <= 3 ? [{ w: shiftWeek(thisWeek, -1), last: true }] : [];
    candidates.push({ w: thisWeek, last: false });
    for (const { w, last } of candidates) {
      const c = await weekClose(w, today);
      const title = last ? t("Close last week (W{n})", { n: w.week }) : t("Close the week (W{n})", { n: w.week });
      if (c.over && !c.done) weeks.push({ key: w.key, title, open: c.items.filter((i) => i.state !== "ok").length, href: `/?week=${w.key}` });
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
    dates: reminders.map((r) => ({ key: `${r.date.id}:${r.on}`, title: upcomingTitle(r, t), inDays: r.inDays, href: `/personen/${r.person.id}` })),
    hours,
    weeks,
    t,
  });

  return { run, open, mine, asking, reportedDone, due, flagged, waiting, meetings, unanswered, hours, problems, reminders, next, today, now };
}

const NEXT_TONE: Record<import("@/lib/heute-next").NextTone, string> = {
  red: "font-medium text-red-600 dark:text-red-400",
  amber: "text-amber-600 dark:text-amber-400",
  indigo: "text-indigo-600 dark:text-indigo-400",
  zinc: "text-zinc-500",
};

const problemLabels = (): Record<"login" | "chrome" | "broken", string> => ({
  login: t("Sign-in needed"),
  chrome: t("automation Chrome isn't running"),
  broken: t("failing"),
});

/**
 * Heute: the day on one page — what the Lage says, what's due, what agents ask, today's meetings,
 * messages waiting for your answer, who you're waiting on, and today's hours against the target.
 * Each part only with its plugin.
 */
export default async function HeutePage() {
  await connection();
  if (!isInstalled("todos")) return <PluginNotInstalled id="todos" />;
  const { run, mine, asking, reportedDone, due, flagged, waiting, meetings, unanswered, hours, problems, reminders, next, today, now } = await heuteData();

  const problem = problemLabels();
  const todo = (td: TodoView, extra?: React.ReactNode) => (
    <li key={td.id} className="flex items-baseline gap-2 text-sm">
      <Link href={`/t/${td.id}`} className="font-mono text-xs text-zinc-400 hover:underline">
        {td.ref}
      </Link>
      <span className="min-w-0 flex-1">{td.text}</span>
      {extra}
    </li>
  );

  return (
    <div className="page">
      <div className="page-aside">
        <h1 className="text-lg font-semibold">{t("Today")}</h1>
        <p className="text-sm text-zinc-500">{formatLongDay(today)}</p>
        {run?.result?.lede && (
          <div className="space-y-1">
            <p className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">{run.result.lede}</p>
            <Link href="/todos" className="text-xs text-indigo-600 hover:underline dark:text-indigo-400">
              {t("To the briefing →")}
            </Link>
          </div>
        )}
        {hours && (
          <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
            <div className="text-xs text-zinc-500 uppercase">{t("Hours today")}</div>
            <div className="text-2xl font-semibold tabular-nums">
              {formatHours(hours.booked)} <span className="text-base font-normal text-zinc-400">/ {formatHours(hours.target)}</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded bg-zinc-200 dark:bg-zinc-800">
              <div className="h-full bg-indigo-500" style={{ width: `${Math.min(100, hours.target ? (hours.booked / hours.target) * 100 : 0)}%` }} />
            </div>
            <Link href="/feierabend" className="mt-1 block text-xs text-indigo-600 hover:underline dark:text-indigo-400">
              {hours.suggestions
                ? hours.suggestions === 1
                  ? t("1 suggestion from today — book the day →")
                  : t("{n} suggestions from today — book the day →", { n: hours.suggestions })
                : t("Book the day (End of day) →")}
            </Link>
          </div>
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {next.length > 0 && (
          <section className="card p-4 xl:col-span-2">
            <h2 className="mb-2 text-sm font-semibold text-zinc-500 uppercase">{t("Up next")}</h2>
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
          <Card title={t("Syncs with problems")} count={problems.length}>
            <ul className="space-y-1.5">
              {problems.map((p) => (
                <li key={p.key} className="text-sm">
                  <div className="flex items-baseline gap-2">
                    <Link href={p.kind === "login" ? "/logins" : p.href} className="shrink-0 font-medium hover:underline">
                      {p.label}
                    </Link>
                    <span className="min-w-0 flex-1 text-red-600 dark:text-red-400">{problem[p.kind]}</span>
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
          <Card title={t("Reported done by workers")} count={reportedDone.length} href="/todos">
            <ul className="space-y-1.5">{reportedDone.map((x) => todo(x, <span className="shrink-0 text-xs text-emerald-600 dark:text-emerald-400">✓</span>))}</ul>
          </Card>
        )}
        {asking.length > 0 && (
          <Card title={t("Agents ask you")} count={asking.length}>
            <ul className="space-y-1.5">{asking.map((x) => todo(x, <span className="shrink-0 text-xs text-amber-600 dark:text-amber-400">❗</span>))}</ul>
          </Card>
        )}

        {reminders.length > 0 && (
          <Card title={t("Reminders")} count={reminders.length} href="/personen">
            <ul className="space-y-1.5">
              {reminders.map((r) => (
                <li key={`${r.date.id}:${r.on}`} className="flex items-baseline gap-2 text-sm">
                  <span className="shrink-0">{r.date.kind === "birthday" ? "🎂" : "📅"}</span>
                  <Link href={`/personen/${r.person.id}`} className="min-w-0 flex-1 hover:underline">
                    {upcomingTitle(r, t)}
                  </Link>
                  <span className={`shrink-0 text-xs ${r.inDays === 0 ? "font-medium text-amber-700 dark:text-amber-400" : "text-zinc-500"}`}>{inDaysText(r.inDays, r.on, t)}</span>
                  <form action={remindedFormAction} className="shrink-0">
                    <input type="hidden" name="dateId" value={r.date.id} />
                    <input type="hidden" name="on" value={r.on} />
                    <button className="text-xs text-zinc-400 hover:text-zinc-700 hover:underline dark:hover:text-zinc-200" title={t("Done — don't show again until next time")}>
                      {t("done")}
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <Card title={t("Due")} count={due.length + flagged.length} href="/todos">
          {due.length || flagged.length ? (
            <ul className="space-y-1.5">
              {due.map((x) => todo(x, <span className={`shrink-0 text-xs ${dueTone(x.due!)}`}>{dueText(x.due!, t)}</span>))}
              {flagged.map((x) => todo(x, <span className="shrink-0 text-xs text-red-600 dark:text-red-400">{t("important")}</span>))}
            </ul>
          ) : (
            <EmptyState faint>
              {mine.length === 1
                ? t("Nothing due in the next three days. 1 todo open.")
                : t("Nothing due in the next three days. {n} todos open.", { n: mine.length })}
            </EmptyState>
          )}
        </Card>

        {isInstalled("outlook-calendar") && (
          <Card title={t("Meetings")} count={meetings.length} href="/calendar">
            {meetings.length ? (
              <ul className="space-y-1.5">
                {meetings.map((m, i) => {
                  const live = now >= new Date(m.start).getTime() && now < new Date(m.end).getTime();
                  return (
                    <li key={i} className={`flex items-baseline gap-2 text-sm ${new Date(m.end).getTime() < now ? "text-zinc-400" : ""}`}>
                      <span className="w-24 shrink-0 text-xs text-zinc-500 tabular-nums">
                        {formatTime(m.start)}–{formatTime(m.end)}
                      </span>
                      <span className={`min-w-0 flex-1 ${live ? "font-medium" : ""}`}>{m.subject}</span>
                      {live && <span className="shrink-0 text-xs text-emerald-600 dark:text-emerald-400">{t("now")}</span>}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState faint>{t("No meetings today.")}</EmptyState>
            )}
          </Card>
        )}

        {(isInstalled("whatsapp") || isInstalled("signal") || isInstalled("teams")) && (
          <Card title={t("Waiting for your answer")} count={unanswered.length} href="/mail">
            {unanswered.length ? (
              <ul className="space-y-1.5">
                {unanswered.slice(0, 12).map((u) => (
                  <li key={u.key} className="text-sm">
                    <a href={u.href} className="flex items-baseline gap-2 hover:underline" {...(u.href.startsWith("http") ? { target: "_blank", rel: "noreferrer" } : {})}>
                      <span className="shrink-0 font-medium">{u.who}</span>
                      <span className="min-w-0 flex-1 truncate text-zinc-500">{u.text}</span>
                      <span className="shrink-0 text-xs text-zinc-400">
                        {u.count > 1 ? `${t("{n} messages", { n: u.count })} · ` : ""}
                        {u.source} · {ago(u.since, now)}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState faint>{t("Nobody is waiting for you.")}</EmptyState>
            )}
          </Card>
        )}

        <Card title={t("Waiting on others")} count={waiting.length} href="/todos">
          {waiting.length ? (
            <ul className="space-y-1.5">{waiting.slice(0, 10).map((x) => todo(x, <span className="shrink-0 text-xs text-zinc-400">⏳ {ago(x.createdAt, now)}</span>))}</ul>
          ) : (
            <EmptyState faint>{t("Nothing has been waiting longer than three days.")}</EmptyState>
          )}
        </Card>
      </div>
    </div>
  );
}
