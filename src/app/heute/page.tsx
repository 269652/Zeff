import { SourceHealthLine } from "@/components/SourceHealthLine";
import { EmptyState } from "@/components/EmptyState";
import type { Metadata } from "next";
import { t } from "@/lib/i18n/server";
import Link from "next/link";
import { connection } from "next/server";
import { daysUntil, dueText, dueTone } from "@/lib/boards/due-shared";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { formatHours, formatLongDay, formatTime, roundQuarter } from "@/lib/format";
import { dayFrame, dayProgress, freeWindows, phaseOf, workSpan, type DayPhase } from "@/lib/heute-day";
import { DayTimeline } from "./DayTimeline";
import { MeetingSoon } from "@/plugins/know/ui/MeetingSoon";
import type { TodoView } from "@/lib/boards/shared";
import { remindedFormAction } from "@/plugins/people/server-actions";
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

  // What was promised, by them or by you, and is due (or has no date): read from the messages (Personen plugin).
  let commitments: { id: number; personId: number; personName: string; text: string; due: string; mine: boolean }[] = [];
  if (isInstalled("people")) {
    const { openCommitments } = await import("@/plugins/people/graph");
    const day = iso;
    commitments = openCommitments()
      .filter((c) => c.due && c.due <= day)
      .slice(0, 8)
      .map((c) => ({ id: c.id, personId: c.personId, personName: c.personName, text: c.text, due: c.due, mine: c.direction === "mine" }));
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

  return { run, open, mine, asking, reportedDone, due, flagged, waiting, meetings, unanswered, hours, problems, sourceIssues, reminders, commitments, next, today, now };
}

const NEXT_TONE: Record<import("@/lib/heute-next").NextTone, string> = {
  red: "font-medium text-red-600 dark:text-red-400",
  amber: "text-amber-600 dark:text-amber-400",
  indigo: "text-indigo-600 dark:text-indigo-400",
  zinc: "text-zinc-500",
};

/** The colour rail of an up-next card (and of the focus card's glow). */
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

/** The sky of the hero: it follows the time of day. */
const SKY: Record<DayPhase, string> = {
  night: "from-slate-800 via-indigo-900 to-violet-900 text-white",
  morning: "from-amber-100 via-rose-100 to-sky-100 text-zinc-900 dark:from-amber-950 dark:via-rose-950 dark:to-sky-950 dark:text-zinc-50",
  day: "from-sky-100 via-indigo-100 to-violet-100 text-zinc-900 dark:from-sky-950 dark:via-indigo-950 dark:to-violet-950 dark:text-zinc-50",
  evening: "from-orange-100 via-fuchsia-100 to-indigo-200 text-zinc-900 dark:from-orange-950 dark:via-fuchsia-950 dark:to-indigo-950 dark:text-zinc-50",
};

const greeting = (p: DayPhase) => (p === "morning" ? t("Good morning") : p === "day" ? t("Good day") : p === "evening" ? t("Good evening") : t("Working late?"));

const hoursText = (ms: number) => `${formatHours(roundQuarter(ms / 3600e3))} h`;

/** Two rings: the outer one is the working day passing, the inner one the hours booked against the target. */
function DayRing({ booked, target, progress, label }: { booked: number; target: number; progress: number; label: string }) {
  const ring = (r: number, frac: number, cls: string) => {
    const c = 2 * Math.PI * r;
    return <circle cx="60" cy="60" r={r} fill="none" strokeWidth="7" strokeLinecap="round" className={cls} strokeDasharray={`${c * Math.min(1, Math.max(0, frac))} ${c}`} transform="rotate(-90 60 60)" />;
  };
  const track = (r: number) => <circle cx="60" cy="60" r={r} fill="none" strokeWidth="7" className="stroke-black/10 dark:stroke-white/15" />;
  const done = target > 0 && booked >= target - 0.01;
  return (
    <div className="relative size-36 shrink-0 sm:size-40" role="img" aria-label={label}>
      <svg viewBox="0 0 120 120" className="size-full">
        {track(54)}
        {ring(54, progress, "stroke-zinc-500/70 dark:stroke-zinc-300/70")}
        {track(41)}
        {ring(41, target ? booked / target : 0, done ? "stroke-emerald-500" : "stroke-indigo-500")}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-2xl leading-none font-semibold tabular-nums">{formatHours(booked)}</span>
        <span className="mt-0.5 text-xs opacity-70 tabular-nums">{t("of {target} h", { target: formatHours(target) })}</span>
      </div>
    </div>
  );
}

function Card({ id, title, href, count, tone = "zinc", children }: { id?: string; title: string; href?: string; count?: number; tone?: "zinc" | "red" | "amber" | "emerald" | "indigo"; children: React.ReactNode }) {
  const rail = { zinc: "", red: "border-t-2 border-t-red-500", amber: "border-t-2 border-t-amber-400", emerald: "border-t-2 border-t-emerald-500", indigo: "border-t-2 border-t-indigo-500" }[tone];
  return (
    <section id={id} className={`card flex scroll-mt-4 flex-col p-4 ${rail}`}>
      <h2 className="mb-2 flex items-baseline justify-between gap-2 text-sm font-semibold text-zinc-500 uppercase">
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

/**
 * Heute: the day on one page. The hero follows the time of day — a greeting, the one thing to start
 * with, the hours against the target and the working day passing; then the rest of what's next, the
 * day as a timeline with its free windows, and the streams (agents asking, what's due, messages
 * waiting for you, who you're waiting on). Each part only with its plugin.
 */
export default async function HeutePage() {
  await connection();
  if (!isInstalled("todos")) return <PluginNotInstalled id="todos" />;
  const { run, mine, asking, reportedDone, due, flagged, waiting, meetings, unanswered, hours, problems, sourceIssues, reminders, commitments, next, today, now } = await heuteData();

  const problem = problemLabels();
  const phase = phaseOf(now);
  const work = workSpan(now);
  const progress = dayProgress(now, work);
  const frame = dayFrame(now, meetings);
  const windows = freeWindows(meetings, now, work);
  const meetingsLeft = meetings.filter((m) => Date.parse(m.end) > now).length;
  const nextFree = windows[0];
  const [focus, ...rest] = next;
  const dark = phase === "night";

  const todo = (td: TodoView, extra?: React.ReactNode) => (
    <li key={td.id} className="flex items-baseline gap-2 text-sm">
      <Link href={`/t/${td.id}`} className="font-mono text-xs text-zinc-400 hover:underline">
        {td.ref}
      </Link>
      <span className="min-w-0 flex-1">{td.text}</span>
      {extra}
    </li>
  );

  // The jump chips in the sidebar: what there is, with its number.
  const chips: { href: string; label: string; n: number; tone: string }[] = [
    { href: "#asking", label: t("Agents ask you"), n: asking.length, tone: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200" },
    { href: "#due", label: t("Due"), n: due.length + flagged.length, tone: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200" },
    { href: "#day", label: t("Meetings"), n: meetingsLeft, tone: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200" },
    { href: "#answer", label: t("Waiting for your answer"), n: unanswered.length, tone: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200" },
    { href: "#waiting", label: t("Waiting on others"), n: waiting.length, tone: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200" },
  ].filter((c) => c.n > 0);

  return (
    <div className="page">
      <div className="page-aside">
        <h1 className="text-lg font-semibold">{t("Today")}</h1>
        <p className="text-sm text-zinc-500">{formatLongDay(today)}</p>
        {chips.length > 0 && (
          <ul className="flex flex-wrap gap-1.5">
            {chips.map((c) => (
              <li key={c.href}>
                <a href={c.href} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition hover:brightness-95 ${c.tone}`}>
                  <span className="tabular-nums">{c.n}</span>
                  {c.label}
                </a>
              </li>
            ))}
          </ul>
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
                  <span className="shrink-0 text-xs text-red-700/70 dark:text-red-300/70">
                    {p.failures}× · {ago(p.since, now)}
                  </span>
                </div>
                {p.message && (
                  <p className="truncate text-xs text-red-700/80 dark:text-red-300/70" title={p.message}>
                    {p.message}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <SourceHealthLine issues={sourceIssues} />

      {/* The hero: the sky of the hour, the one thing to start with, the day as two rings. */}
      <section className={`relative overflow-hidden rounded-2xl bg-gradient-to-br p-5 shadow-sm sm:p-7 ${SKY[phase]}`}>
        <div aria-hidden className="pointer-events-none absolute -top-16 -right-10 size-56 rounded-full bg-white/30 blur-3xl dark:bg-white/10" />
        <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 space-y-3">
            <p className="text-3xl font-semibold tracking-tight sm:text-4xl">{greeting(phase)}</p>
            {focus ? (
              <a
                href={focus.href || undefined}
                {...(focus.href.startsWith("http") ? { target: "_blank", rel: "noreferrer" } : {})}
                className={`group block max-w-xl rounded-xl border-l-4 p-3 backdrop-blur transition hover:translate-x-0.5 ${NEXT_RAIL[focus.tone]} ${dark ? "bg-white/10 hover:bg-white/15" : "bg-white/60 hover:bg-white/80 dark:bg-black/25 dark:hover:bg-black/35"}`}
              >
                <span className="text-xs font-semibold tracking-wider uppercase opacity-60">{t("Start here")}</span>
                <span className="mt-0.5 block text-lg leading-snug font-medium group-hover:underline">{focus.title}</span>
                <span className={`text-xs ${dark ? "text-white/70" : NEXT_TONE[focus.tone]}`}>{focus.detail}</span>
              </a>
            ) : (
              <p className="max-w-xl text-lg opacity-80">{t("Nothing pressing. A clear day — use it.")}</p>
            )}
            {run?.result?.lede && (
              <p className="max-w-xl text-sm leading-relaxed opacity-80">
                <span aria-hidden className="mr-1 text-lg leading-none opacity-50">“</span>
                {run.result.lede}
                <Link href="/todos" className="ml-2 text-xs whitespace-nowrap underline-offset-2 hover:underline">
                  {t("To the briefing →")}
                </Link>
              </p>
            )}
          </div>
          {hours && (
            <div className="flex shrink-0 flex-col items-center gap-1.5 self-center">
              <DayRing booked={hours.booked} target={hours.target} progress={progress} label={t("Hours today")} />
              <p className="text-center text-xs opacity-70">
                {t("inner: hours booked · outer: the working day")}
              </p>
            </div>
          )}
        </div>
      </section>

      {/* A meeting about to start: what you should know before it (the know plugin). */}
      <MeetingSoon now={now} />

      {rest.length > 0 && (
        <section aria-label={t("Up next")}>
          <h2 className="mb-2 text-sm font-semibold text-zinc-500 uppercase">{t("Then")}</h2>
          <ol className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {rest.map((n, i) => {
              const body = (
                <>
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-xs font-semibold text-zinc-500 tabular-nums dark:bg-zinc-800">{i + 2}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{n.title}</span>
                    <span className={`block truncate text-xs ${NEXT_TONE[n.tone]}`}>{n.detail}</span>
                  </span>
                </>
              );
              const cls = `card flex items-center gap-2.5 border-l-4 p-2.5 ${NEXT_RAIL[n.tone]}`;
              return (
                <li key={n.key}>
                  {n.href ? (
                    <a href={n.href} className={`${cls} transition hover:-translate-y-0.5 hover:shadow-md`} {...(n.href.startsWith("http") ? { target: "_blank", rel: "noreferrer" } : {})}>
                      {body}
                    </a>
                  ) : (
                    <div className={cls}>{body}</div>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {isInstalled("outlook-calendar") && (
        <section id="day" className="card scroll-mt-4 space-y-3 p-4">
          <h2 className="flex flex-wrap items-baseline justify-between gap-2 text-sm font-semibold text-zinc-500 uppercase">
            <span>{t("Your day")}</span>
            <span className="text-xs font-normal tracking-normal normal-case">
              {meetingsLeft === 0 ? t("No meetings left") : meetingsLeft === 1 ? t("1 meeting left") : t("{n} meetings left", { n: meetingsLeft })}
              {nextFree && <span className="ml-2 text-emerald-600 dark:text-emerald-400">{t("Free {from}–{to}", { from: formatTime(Math.max(nextFree.from, now)), to: formatTime(nextFree.to) })}</span>}
            </span>
          </h2>
          <DayTimeline
            frame={frame}
            meetings={meetings.map((m) => ({ subject: m.subject, start: Date.parse(m.start), end: Date.parse(m.end), online: m.online }))}
            windows={windows.map((w) => ({ ...w, text: hoursText(w.to - w.from) }))}
            initialNow={now}
            labels={{ now: t("now"), online: t("online") }}
          />
          {meetings.length === 0 && <EmptyState faint>{t("No meetings today.")}</EmptyState>}
          <Link href="/calendar" className="text-xs text-indigo-600 hover:underline dark:text-indigo-400">
            {t("all →")}
          </Link>
        </section>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        {reportedDone.length > 0 && (
          <Card id="done" title={t("Reported done by workers")} count={reportedDone.length} href="/todos" tone="emerald">
            <ul className="space-y-1.5">{reportedDone.map((x) => todo(x, <span className="shrink-0 text-xs text-emerald-600 dark:text-emerald-400">✓</span>))}</ul>
          </Card>
        )}
        {asking.length > 0 && (
          <Card id="asking" title={t("Agents ask you")} count={asking.length} tone="red">
            <ul className="space-y-1.5">{asking.map((x) => todo(x, <span className="shrink-0 text-xs text-amber-600 dark:text-amber-400">❗</span>))}</ul>
          </Card>
        )}

        {commitments.length > 0 && (
          <Card id="commitments" title={t("Commitments due")} count={commitments.length} href={peopleHome()} tone="indigo">
            <ul className="space-y-1.5">
              {commitments.map((c) => (
                <li key={c.id} className="flex items-baseline gap-2 text-sm">
                  <span className={`shrink-0 text-xs font-medium ${c.mine ? "text-amber-700 dark:text-amber-400" : "text-sky-700 dark:text-sky-400"}`}>{c.mine ? t("I owe") : t("They owe")}</span>
                  <Link href={personHref(c.personId)} className="min-w-0 flex-1 hover:underline">
                    {c.personName}: {c.text}
                  </Link>
                  <span className="shrink-0 text-xs text-zinc-500">{c.due}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {reminders.length > 0 && (
          <Card id="reminders" title={t("Reminders")} count={reminders.length} href={peopleHome()} tone="indigo">
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
                    <button className="text-xs text-zinc-400 hover:text-zinc-700 hover:underline dark:hover:text-zinc-200" title={t("Done — don't show again until next time")}>
                      {t("done")}
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <Card id="due" title={t("Due")} count={due.length + flagged.length} href="/todos" tone="amber">
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

        {(isInstalled("whatsapp") || isInstalled("signal") || isInstalled("teams")) && (
          <Card id="answer" title={t("Waiting for your answer")} count={unanswered.length} href="/mail" tone="indigo">
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

        <Card id="waiting" title={t("Waiting on others")} count={waiting.length} href="/todos">
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
