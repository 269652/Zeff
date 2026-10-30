import { SourceHealthLine } from "@/components/SourceHealthLine";
import { EmptyState } from "@/components/EmptyState";
import type { Metadata } from "next";
import { t } from "@/lib/i18n/server";
import Link from "next/link";
import { getPref } from "@/lib/prefs";
import { connection } from "next/server";
import { dueText } from "@/lib/boards/due-shared";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { formatHours, formatLongDay, roundQuarter } from "@/lib/format";
import { dayFrame, dayProgress, freeWindows, phaseOf, workSpan, type DayPhase } from "@/lib/heute-day";
import { DayTimeline } from "./DayTimeline";
import { DayPlan } from "./DayPlan";
import { TodayTodo } from "./TodayTodo";
import { dayOf } from "@/lib/calendar/ir-shared";
import type { TodayAppointment } from "@/lib/heute-today";
import { MeetingSoon } from "@/plugins/know/ui/MeetingSoon";
import type { TodoView } from "@/lib/boards/shared";
import { promiseKeptFormAction, remindedFormAction } from "@/plugins/people/server-actions";
import { loopFormAction } from "@/plugins/loops/server-actions";
import { peopleHome, personHref } from "@/plugins/workspace/people-database";
import { inDaysText, upcomingTitle } from "@/plugins/people/shared";
import { isInstalled } from "@/plugins/state";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Today") };
}

const ago = (iso: string, now: number) => {
  const d = Math.floor((now - new Date(iso).getTime()) / 864e5);
  return d <= 0 ? t("today") : d === 1 ? t("since yesterday") : t("for {n} days", { n: d });
};

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
  // Waiting on others for three days or more: time to ask again.
  const waiting = open.filter((x) => x.owner === "other" && now - new Date(x.createdAt).getTime() >= 3 * 864e5).sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  // What matters today: appointments (with whom to prepare), what is due, promises, what is new (lib/heute-today.ts).
  const { todayData } = await import("@/lib/heute-today");
  const day = await todayData(new Date(now));

  // Today's meetings for the timeline: the Calendar's (Outlook's synced into it), else Outlook's calendar inbox.
  const today = new Date();
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  let meetings: { subject: string; start: string; end: string; online: boolean }[] = [];
  if (isInstalled("calendar")) {
    meetings = day.appointments.filter((a) => !a.tomorrow && !a.allDay).map((a) => ({ subject: a.title || t("(no title)"), start: a.start, end: a.end, online: a.online }));
  } else if (isInstalled("outlook-calendar")) {
    const { readInbox } = await import("@/lib/calendar/inbox");
    meetings = readInbox()
      .filter((e) => !e.isCancelled && !e.isAllDay && e.start.dateTime.slice(0, 10) === iso && e.showAs !== "free")
      .map((e) => ({ subject: e.subject ?? t("(no title)"), start: e.start.dateTime, end: e.end.dateTime, online: !!e.isOnlineMeeting }))
      .sort((a, b) => a.start.localeCompare(b.start));
  }
  const appointments: TodayAppointment[] = isInstalled("calendar")
    ? day.appointments
    : meetings.filter((m) => Date.parse(m.end) > now).map((m, i) => ({ id: -i - 1, title: m.subject, start: m.start.slice(0, 16), end: m.end.slice(0, 16), allDay: false, location: "", online: m.online, tomorrow: false, people: [], href: "/calendar" }));

  // Messages waiting for your answer: a chat whose last message (this week) isn't yours.
  const unanswered: { key: string; who: string; text: string; at: string; since: string; count: number; href: string; source: string }[] = [];
  if (isInstalled("whatsapp")) {
    // One line per chat, while the last word isn't yours; a group only when something in it is to you.
    const { whatsappChatsWaiting } = await import("@/lib/mail/store");
    for (const c of whatsappChatsWaiting(7, now))
      unanswered.push({ key: c.key, who: c.who, text: c.text, at: c.lastAt, since: c.since, count: c.count, href: `/mail?${new URLSearchParams({ channel: "whatsapp", open: c.convId })}`, source: "WhatsApp" });
  }
  if (isInstalled("signal")) {
    const { chatsWaiting } = await import("@/lib/mail/store");
    for (const c of chatsWaiting("Signal", 7, now))
      unanswered.push({ key: c.key, who: c.who, text: c.text, at: c.lastAt, since: c.since, count: c.count, href: `/mail?${new URLSearchParams({ channel: "signal", open: c.convId })}`, source: "Signal" });
  }
  if (isInstalled("teams")) {
    // One line per chat (not per message), and only while the last word isn't yours.
    const { teamsChatsWaiting } = await import("@/lib/teams/store");
    for (const c of teamsChatsWaiting(3, now)) unanswered.push({ key: c.key, who: c.who, text: c.text, at: c.lastAt, since: c.since, count: c.count, href: c.link || "/mail?channel=teams", source: "Teams" });
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
  // Sources that aren't well though their runs may say ok — silent, not running, their app changed (the failing ones are above).
  let sourceIssues: import("@/components/SourceHealthLine").SourceIssue[] = [];
  try {
    const { sourceHealth } = await import("@/lib/sync/source-health");
    const { healthLabel, healthReason } = await import("@/lib/sync/source-health-shared");
    sourceIssues = (await sourceHealth()).flatMap((h) =>
      h.state === "stale" || h.state === "silent" || h.state === "drift" ? [{ key: h.key, label: h.label, href: h.href, state: h.state, word: healthLabel(t, h.state), reason: healthReason(t, h) }] : [],
    );
  } catch (e) {
    console.error("[heute] source health", e);
  }

  // Birthdays and other dates of your people, inside their reminder (Personen plugin).
  let reminders: import("@/plugins/people/shared").Upcoming[] = [];
  if (isInstalled("people")) {
    const { upcoming } = await import("@/plugins/people/store");
    reminders = upcoming({ withinReminder: true });
  }

  // The open loops past their day (or open a week): a gentle nudge — at most a few, yours first, not those put off (Open loops plugin).
  let loopNudges: { loops: { ref: string; who: string; personId: number | null; text: string; due: string; at: string; mine: boolean }[]; total: number } | null = null;
  if (isInstalled("loops")) {
    try {
      const { nudges } = await import("@/plugins/loops/query");
      const { NUDGE_CAP } = await import("@/plugins/loops/shared");
      const n = nudges(NUDGE_CAP, new Date(now));
      loopNudges = { loops: n.loops.map((l) => ({ ref: l.ref, who: l.who, personId: l.personId, text: l.text, due: l.due, at: l.at, mine: l.direction === "mine" })), total: n.total };
    } catch (e) {
      console.error("[heute] open loops", e);
    }
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
    dates: reminders.map((r) => ({ key: `${r.date.id}:${r.on}`, title: upcomingTitle(r, t), inDays: r.inDays, href: personHref(r.person.id) })),
    hours,
    weeks,
    t,
  });

  return { run, asking, reportedDone, waiting, meetings, appointments, day, unanswered, hours, problems, sourceIssues, reminders, loopNudges, next, today, now };
}

const NEXT_TONE: Record<import("@/lib/heute-next").NextTone, string> = {
  red: "font-medium text-red-600 dark:text-red-400",
  amber: "text-amber-600 dark:text-amber-400",
  indigo: "text-indigo-600 dark:text-indigo-400",
  zinc: "text-zinc-500",
};

/** The colour rail of the focus ("Start here"). */
const NEXT_RAIL: Record<import("@/lib/heute-next").NextTone, string> = {
  red: "border-l-red-500",
  amber: "border-l-amber-400",
  indigo: "border-l-indigo-500",
  zinc: "border-l-zinc-300 dark:border-l-zinc-600",
};

const problemLabels = (): Record<"login" | "chrome" | "broken", string> => ({
  login: t("Sign-in needed"),
  chrome: t("automation Chrome isn't running"),
  broken: t("failing"),
});

const greeting = (p: DayPhase) => (p === "morning" ? t("Good morning") : p === "day" ? t("Good day") : p === "evening" ? t("Good evening") : t("Working late?"));

const hoursText = (ms: number) => `${formatHours(roundQuarter(ms / 3600e3))} h`;

/** A light box, as the workspace's widgets: a border, no shadow. */
const BOX = "rounded-xl border border-zinc-200 dark:border-zinc-800";

/** Two rings: the outer one is the working day passing, the inner one the hours booked against the target. */
function DayRing({ booked, target, progress, label }: { booked: number; target: number; progress: number; label: string }) {
  const ring = (r: number, frac: number, cls: string) => {
    const c = 2 * Math.PI * r;
    return <circle cx="60" cy="60" r={r} fill="none" strokeWidth="7" strokeLinecap="round" className={cls} strokeDasharray={`${c * Math.min(1, Math.max(0, frac))} ${c}`} transform="rotate(-90 60 60)" />;
  };
  const track = (r: number) => <circle cx="60" cy="60" r={r} fill="none" strokeWidth="7" className="stroke-black/10 dark:stroke-white/15" />;
  const done = target > 0 && booked >= target - 0.01;
  return (
    <div className="relative size-28 shrink-0" role="img" aria-label={label}>
      <svg viewBox="0 0 120 120" className="size-full">
        {track(54)}
        {ring(54, progress, "stroke-zinc-400 dark:stroke-zinc-500")}
        {track(41)}
        {ring(41, target ? booked / target : 0, done ? "stroke-emerald-500" : "stroke-indigo-500")}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-xl leading-none font-semibold tabular-nums">{formatHours(booked)}</span>
        <span className="mt-0.5 text-xs text-zinc-500 tabular-nums">{t("of {target} h", { target: formatHours(target) })}</span>
      </div>
    </div>
  );
}

/** One part of the day: a heading, its list — shown only when it has something (the caller decides). */
function Section({ id, title, count, href, children }: { id: string; title: string; count?: number; href?: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className={`${BOX} scroll-mt-4 p-4`}>
      <h2 id={`${id}-h`} className="mb-2 flex items-baseline justify-between gap-2 text-sm font-semibold text-zinc-500 uppercase">
        <span>
          {title}
          {count !== undefined && <span className="ml-1.5 rounded-full bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-500 tabular-nums dark:bg-zinc-800">{count}</span>}
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

const SUB = "mt-3 mb-1 text-xs font-medium text-zinc-500 first:mt-0";
const LINK_BUTTON = "text-xs text-zinc-400 hover:text-zinc-700 hover:underline dark:hover:text-zinc-200";

/**
 * Heute: what matters today, on one page, in this order — each part only when it has something, each line done in place:
 * the appointments of today and tomorrow morning (whom to prepare for), the todos due and overdue (ticked or dismissed here),
 * the promises due, who waits on you and whom you wait on, what is new since yesterday, and "✨ Plan my day" (the AI's time
 * blocks for the todos around the appointments, applied as suggestions into the day's plan calendar). Above it the greeting with
 * the one thing to start with; below it what else asks for you (agents, workers, reminders, open loops).
 */
export default async function HeutePage() {
  await connection();
  if (!isInstalled("todos")) return <PluginNotInstalled id="todos" />;
  const { run, asking, reportedDone, waiting, meetings, appointments, day, unanswered, hours, problems, sourceIssues, reminders, loopNudges, next, today, now } = await heuteData();

  const problem = problemLabels();
  const phase = phaseOf(now);
  const work = workSpan(now);
  const windows = freeWindows(meetings, now, work);
  const [focus] = next;
  const todayIso = dayOf(new Date(now));
  const planAvailable = isInstalled("llm") && isInstalled("calendar") && day.due.length > 0;
  const nothing = !appointments.length && !day.due.length && !day.promises.length && !unanswered.length && !waiting.length && !day.learned.length && !day.news?.count;

  const todo = (td: TodoView, extra?: React.ReactNode) => (
    <li key={td.id} className="flex items-baseline gap-2 text-sm">
      <Link href={`/t/${td.id}`} className="font-mono text-xs text-zinc-400 hover:underline">
        {td.ref}
      </Link>
      <span className="min-w-0 flex-1">{td.text}</span>
      {extra}
    </li>
  );
  const when = (a: TodayAppointment) => (a.allDay ? t("all day") : `${a.start.slice(11, 16)}–${a.end.slice(11, 16)}`);
  const todayAppts = appointments.filter((a) => !a.tomorrow);
  const tomorrowAppts = appointments.filter((a) => a.tomorrow);
  const apptList = (list: TodayAppointment[]) => (
    <ul className="space-y-1.5">
      {list.map((a) => (
        <li key={`${a.id}:${a.start}`} className="text-sm">
          <div className="flex items-baseline gap-2">
            <span className="w-24 shrink-0 font-mono text-xs text-zinc-500 tabular-nums">{when(a)}</span>
            <Link href={a.href} className="min-w-0 flex-1 hover:underline">
              {a.title || t("(no title)")}
              {a.location && <span className="ml-1.5 text-xs text-zinc-500">· {a.location}</span>}
            </Link>
          </div>
          {a.people.length > 0 && (
            <p className="ml-26 text-xs text-indigo-700 dark:text-indigo-300">
              {t("Prepare:")}{" "}
              {a.people.map((p, i) => (
                <span key={p.id}>
                  {i > 0 && ", "}
                  <Link href={personHref(p.id)} className="hover:underline">
                    {p.name}
                  </Link>
                </span>
              ))}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
  const promiseList = (list: typeof day.promises) => (
    <ul className="space-y-1.5">
      {list.map((c) => (
        <li key={c.id} className="flex items-baseline gap-2 text-sm">
          <Link href={personHref(c.personId)} className="min-w-0 flex-1 hover:underline">
            {c.personName}: {c.text}
          </Link>
          <span className={`shrink-0 text-xs ${c.overdue ? "text-red-600 dark:text-red-400" : "text-amber-700 dark:text-amber-400"}`}>{dueText(c.due, t)}</span>
          <form action={promiseKeptFormAction} className="shrink-0">
            <input type="hidden" name="claimId" value={c.id} />
            <button className={LINK_BUTTON} aria-label={t("Kept: {text}", { text: c.text })}>
              {t("Kept")}
            </button>
          </form>
        </li>
      ))}
    </ul>
  );
  const myPromises = day.promises.filter((c) => c.mine);
  const theirPromises = day.promises.filter((c) => !c.mine);

  return (
    <div className="page">
      <div className="page-aside">
        <h1 className="text-lg font-semibold">{t("Today")}</h1>
        <p className="text-sm text-zinc-500">{formatLongDay(today)}</p>
        {/* Until it was opened once: the first look — what Zeff found in the last 30 days (lib/first-look.ts). */}
        {!getPref<string | null>("firstLook.seenAt", null) && (
          <Link href="/first-look" className="block rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-sm hover:bg-indigo-100 dark:border-indigo-900 dark:bg-indigo-950/40 dark:hover:bg-indigo-950">
            <span className="font-medium">✨ {t("Your first look")}</span>
            <span className="block text-zinc-600 dark:text-zinc-300">{t("What Zeff found in your last 30 days — forgotten promises, what falls due, unbooked time.")}</span>
          </Link>
        )}
        {hours && (
          <Link href="/feierabend" className="block text-xs text-indigo-600 hover:underline dark:text-indigo-400">
            {hours.suggestions
              ? hours.suggestions === 1
                ? t("1 suggestion from today — book the day →")
                : t("{n} suggestions from today — book the day →", { n: hours.suggestions })
              : t("Book the day (End of day) →")}
          </Link>
        )}
      </div>

      {problems.length > 0 && (
        <section className="rounded-xl border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950/40">
          <h2 className="mb-1.5 text-xs font-semibold text-red-700 uppercase dark:text-red-300">
            {t("Syncs with problems")} <span className="tabular-nums">{problems.length}</span>
          </h2>
          <ul className="space-y-1">
            {problems.map((p) => (
              <li key={p.key} className="text-sm">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <Link href={p.kind === "login" ? "/logins" : p.href} className="shrink-0 font-medium hover:underline">
                    {p.label}
                  </Link>
                  <span className="min-w-0 flex-1 text-red-700 dark:text-red-300">{problem[p.kind]}</span>
                  <span className="shrink-0 text-xs text-red-700 dark:text-red-300">
                    {p.failures}× · {ago(p.since, now)}
                  </span>
                </div>
                {p.message && (
                  <p className="truncate text-xs text-red-700 dark:text-red-300" title={p.message}>
                    {p.message}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <SourceHealthLine issues={sourceIssues} />

      {/* The greeting: the one thing to start with, the briefing's lede, the hours against the target and the working day passing. */}
      <section aria-label={greeting(phase)} className={`${BOX} flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between`}>
        <div className="min-w-0 space-y-2">
          <p className="text-2xl font-semibold tracking-tight">{greeting(phase)}</p>
          {focus ? (
            <a href={focus.href || undefined} {...(focus.href.startsWith("http") ? { target: "_blank", rel: "noreferrer" } : {})} className={`group block max-w-xl border-l-4 pl-3 ${NEXT_RAIL[focus.tone]}`}>
              <span className="text-xs font-semibold tracking-wider text-zinc-500 uppercase">{t("Start here")}</span>
              <span className="block font-medium group-hover:underline">{focus.title}</span>
              <span className={`text-xs ${NEXT_TONE[focus.tone]}`}>{focus.detail}</span>
            </a>
          ) : (
            <p className="max-w-xl text-zinc-500">{t("Nothing pressing. A clear day — use it.")}</p>
          )}
          {run?.result?.lede && (
            <p className="max-w-xl text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
              {run.result.lede}
              <Link href="/todos" className="ml-2 text-xs whitespace-nowrap text-indigo-600 hover:underline dark:text-indigo-400">
                {t("To the briefing →")}
              </Link>
            </p>
          )}
        </div>
        {hours && <DayRing booked={hours.booked} target={hours.target} progress={dayProgress(now, work)} label={t("Hours today")} />}
      </section>

      {/* A meeting about to start: what you should know before it (the know plugin). */}
      <MeetingSoon now={now} />

      {nothing && <EmptyState faint>{t("Nothing due, promised or waiting today.")}</EmptyState>}

      {/* 1. Appointments today and tomorrow morning — with whom (prepare). */}
      {appointments.length > 0 && (
        <Section id="appointments" title={t("Appointments")} count={appointments.length} href={isInstalled("calendar") ? `/kalender?v=day&d=${todayIso}` : "/calendar"}>
          {todayAppts.length > 0 && apptList(todayAppts)}
          {tomorrowAppts.length > 0 && (
            <>
              <h3 className={SUB}>{t("Tomorrow morning")}</h3>
              {apptList(tomorrowAppts)}
            </>
          )}
          {meetings.length > 0 && (
            <div className="mt-3">
              <DayTimeline
                frame={dayFrame(now, meetings)}
                meetings={meetings.map((m) => ({ subject: m.subject, start: Date.parse(m.start), end: Date.parse(m.end), online: m.online }))}
                windows={windows.map((w) => ({ ...w, text: hoursText(w.to - w.from) }))}
                initialNow={now}
                labels={{ now: t("now"), online: t("online") }}
              />
            </div>
          )}
        </Section>
      )}

      {/* 2. Due and overdue: yours, ticked or dismissed here. */}
      {day.due.length > 0 && (
        <Section id="due" title={t("Due and overdue")} count={day.due.length} href="/todos">
          <ul className="space-y-1.5">
            {day.due.map((x) => (
              <TodayTodo key={x.id} id={x.id} todoRef={x.ref} text={x.text} when={dueText(x.due!, t)} overdue={x.due!.slice(0, 10) < todayIso} />
            ))}
          </ul>
        </Section>
      )}

      {/* 3. Promises: what you promised (due), what was promised to you (overdue). */}
      {day.promises.length > 0 && (
        <Section id="promises" title={t("Promises")} count={day.promises.length} href={peopleHome()}>
          {myPromises.length > 0 && (
            <>
              <h3 className={SUB}>{t("You promised")}</h3>
              {promiseList(myPromises)}
            </>
          )}
          {theirPromises.length > 0 && (
            <>
              <h3 className={SUB}>{t("Promised to you, overdue")}</h3>
              {promiseList(theirPromises)}
            </>
          )}
        </Section>
      )}

      {/* 4. Who waits on you (chats whose last word isn't yours), and whom you wait on (todos with someone else's move). */}
      {(unanswered.length > 0 || waiting.length > 0) && (
        <Section id="waiting" title={t("Waiting")} count={unanswered.length + waiting.length}>
          {unanswered.length > 0 && (
            <>
              <h3 className={SUB}>{t("Waiting for your answer")}</h3>
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
            </>
          )}
          {waiting.length > 0 && (
            <>
              <h3 className={SUB}>{t("Waiting on others")}</h3>
              <ul className="space-y-1.5">{waiting.slice(0, 10).map((x) => todo(x, <span className="shrink-0 text-xs text-zinc-400">⏳ {ago(x.createdAt, now)}</span>))}</ul>
            </>
          )}
        </Section>
      )}

      {/* 5. New since yesterday: what was learned about people (to confirm), the news the AI picked. */}
      {(day.learned.length > 0 || !!day.news?.count) && (
        <Section id="new" title={t("New since yesterday")}>
          <ul className="space-y-1.5 text-sm">
            {day.learned.length > 0 && (
              <li>
                <Link href="/review" className="hover:underline">
                  {day.learned.length === 1 ? t("1 thing learned about people — confirm it") : t("{n} things learned about people — confirm them", { n: day.learned.length })}
                </Link>
                <span className="block truncate text-xs text-zinc-500">
                  {day.learned
                    .slice(0, 3)
                    .map((c) => `${c.personName}: ${c.text}`)
                    .join(" · ")}
                </span>
              </li>
            )}
            {day.news && day.news.count > 0 && (
              <li>
                <Link href="/news" className="hover:underline">
                  {day.news.count === 1 ? t("1 new news item") : t("{n} new news items", { n: day.news.count })}
                </Link>
                {day.news.top.map((n) => (
                  <a key={n.id} href={n.url} target="_blank" rel="noreferrer" className="block truncate text-xs text-zinc-500 hover:underline">
                    {n.title} <span className="text-zinc-400">· {n.source}</span>
                  </a>
                ))}
              </li>
            )}
          </ul>
        </Section>
      )}

      {/* 6. Plan my day: the AI's time blocks for today's todos around the appointments — a proposal, applied as suggestions. */}
      {planAvailable && (
        <Section id="plan" title={t("Plan")}>
          <DayPlan />
        </Section>
      )}

      {/* What else asks for you. */}
      {(reportedDone.length > 0 || asking.length > 0 || reminders.length > 0 || (loopNudges && loopNudges.loops.length > 0)) && (
        <div className="grid gap-4 xl:grid-cols-2">
          {asking.length > 0 && (
            <Section id="asking" title={t("Agents ask you")} count={asking.length}>
              <ul className="space-y-1.5">{asking.map((x) => todo(x, <span className="shrink-0 text-xs text-amber-600 dark:text-amber-400">❗</span>))}</ul>
            </Section>
          )}
          {reportedDone.length > 0 && (
            <Section id="done" title={t("Reported done by workers")} count={reportedDone.length} href="/todos">
              <ul className="space-y-1.5">{reportedDone.map((x) => todo(x, <span className="shrink-0 text-xs text-emerald-600 dark:text-emerald-400">✓</span>))}</ul>
            </Section>
          )}
          {loopNudges && loopNudges.loops.length > 0 && (
            <Section id="loops" title={t("Open loops overdue")} count={loopNudges.total} href="/loops?view=overdue">
              <ul className="space-y-1.5">
                {loopNudges.loops.map((l) => (
                  <li key={l.ref} className="flex items-baseline gap-2 text-sm">
                    <span className={`shrink-0 text-xs font-medium ${l.mine ? "text-amber-700 dark:text-amber-400" : "text-sky-700 dark:text-sky-400"}`}>{l.mine ? t("I owe") : t("They owe")}</span>
                    <Link href={l.personId ? personHref(l.personId) : "/loops?view=overdue"} className="min-w-0 flex-1 hover:underline">
                      {l.who}: {l.text}
                    </Link>
                    <span className="shrink-0 text-xs text-zinc-500">{l.due || l.at.slice(0, 10)}</span>
                    <form action={loopFormAction} className="shrink-0">
                      <input type="hidden" name="ref" value={l.ref} />
                      <input type="hidden" name="op" value="later" />
                      <button className={LINK_BUTTON} title={t("Not on the Today page for a few days")}>
                        {t("later")}
                      </button>
                    </form>
                    <form action={loopFormAction} className="shrink-0">
                      <input type="hidden" name="ref" value={l.ref} />
                      <input type="hidden" name="op" value="close" />
                      <button className={LINK_BUTTON} title={t("Kept or answered — closed")}>
                        {t("done")}
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
              {loopNudges.total > loopNudges.loops.length && (
                <Link href="/loops?view=overdue" className="mt-1 block text-xs text-indigo-600 hover:underline dark:text-indigo-400">
                  {t("{n} more →", { n: loopNudges.total - loopNudges.loops.length })}
                </Link>
              )}
            </Section>
          )}
          {reminders.length > 0 && (
            <Section id="reminders" title={t("Reminders")} count={reminders.length} href={peopleHome()}>
              <ul className="space-y-1.5">
                {reminders.map((r) => (
                  <li key={`${r.date.id}:${r.on}`} className="flex items-baseline gap-2 text-sm">
                    <span className="shrink-0">{r.date.kind === "birthday" ? "🎂" : "📅"}</span>
                    <Link href={personHref(r.person.id)} className="min-w-0 flex-1 hover:underline">
                      {upcomingTitle(r, t)}
                    </Link>
                    <span className={`shrink-0 text-xs ${r.inDays === 0 ? "font-medium text-amber-700 dark:text-amber-400" : "text-zinc-500"}`}>{inDaysText(r.inDays, r.on, t)}</span>
                    <form action={remindedFormAction} className="shrink-0">
                      <input type="hidden" name="dateId" value={r.date.id} />
                      <input type="hidden" name="on" value={r.on} />
                      <button className={LINK_BUTTON} title={t("Done — don't show again until next time")}>
                        {t("done")}
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      )}
    </div>
  );
}
