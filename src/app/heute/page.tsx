import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { daysUntil, dueText, dueTone } from "@/components/boards/DueBadge";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { formatHours } from "@/lib/format";
import type { TodoView } from "@/lib/boards/shared";
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
  const unanswered: { key: string; who: string; text: string; at: string; href: string; source: string }[] = [];
  if (isInstalled("whatsapp")) {
    const { listMails } = await import("@/lib/mail/store");
    const seen = new Set<string>();
    for (const m of listMails({ folder: "WhatsApp", limit: 600 })) {
      if (seen.has(m.convId)) continue;
      seen.add(m.convId);
      if (m.fromName !== "Ich" && now - new Date(m.receivedAt).getTime() < 7 * 864e5 && !m.resolvedAt)
        unanswered.push({ key: m.key, who: m.subject, text: m.fromName && m.fromName !== m.subject ? `${m.fromName}: ${m.preview}` : m.preview, at: m.receivedAt, href: `/apps/whatsapp?chat=${encodeURIComponent(m.subject)}`, source: "WhatsApp" });
    }
  }
  if (isInstalled("teams")) {
    const { listTeamsMessages } = await import("@/lib/teams/store");
    for (const m of listTeamsMessages({ kind: "pm", limit: 40 }))
      if (!m.resolvedAt && !m.inContext && now - new Date(m.sentAt).getTime() < 3 * 864e5)
        unanswered.push({ key: m.key, who: m.senderName ?? "Teams", text: m.text, at: m.sentAt, href: m.link || "/teams", source: "Teams" });
  }
  unanswered.sort((a, b) => b.at.localeCompare(a.at));

  // Today's hours against the target, and suggestions waiting.
  let hours: { booked: number; target: number; suggestions: number } | null = null;
  if (isInstalled("zeiterfassung")) {
    const { listEntries } = await import("@/lib/entries");
    const { getDayTargets } = await import("@/lib/schedule");
    const { openSuggestions } = await import("@/lib/work/suggestions");
    hours = {
      booked: listEntries({ from: iso, to: iso }).reduce((s, e) => s + e.hours, 0),
      target: getDayTargets([today])[0]?.target ?? 0,
      suggestions: openSuggestions().filter((s) => s.date === iso).length,
    };
  }

  return { run, open, mine, asking, due, flagged, waiting, meetings, unanswered, hours, today, now };
}

/**
 * Heute: the day on one page — what the Lage says, what's due, what agents ask, today's meetings,
 * messages waiting for your answer, who you're waiting on, and today's hours against the target.
 * Each part only with its plugin.
 */
export default async function HeutePage() {
  await connection();
  if (!isInstalled("todos")) return <PluginNotInstalled id="todos" />;
  const { run, mine, asking, due, flagged, waiting, meetings, unanswered, hours, today, now } = await heuteData();

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
            <Link href="/" className="mt-1 block text-xs text-indigo-600 hover:underline dark:text-indigo-400">
              {hours.suggestions ? `${hours.suggestions} Vorschläge von heute übernehmen →` : "Zum Wochenbericht →"}
            </Link>
          </div>
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {asking.length > 0 && (
          <Card title="Agenten fragen dich" count={asking.length}>
            <ul className="space-y-1.5">{asking.map((t) => todo(t, <span className="shrink-0 text-xs text-amber-600 dark:text-amber-400">❗</span>))}</ul>
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
                        {u.source} · {ago(u.at, now)}
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
