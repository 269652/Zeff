import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { isInstalled } from "@/plugins/state";
import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { connection } from "next/server";
import { clearInboxAction, disconnectCalendarAction } from "@/plugins/outlook-calendar/server-actions";
import { BookmarkletButton } from "@/components/BookmarkletButton";
import { DeviceCodeConnect } from "@/components/DeviceCodeConnect";
import { HashIngest } from "@/components/HashIngest";
import { MeetingImportForm } from "@/components/MeetingImportForm";
import { PasteEventsForm } from "@/components/PasteEventsForm";
import { PersistentDetails } from "@/components/PersistentDetails";
import { SubmitButton } from "@/components/SubmitButton";
import { buildBookmarklet, buildCopyBookmarklet } from "@/lib/calendar/bookmarklet";
import { planImport, type ExclusionReason } from "@/lib/calendar/meetings";
import { getCalendarStatus, getWeekEvents } from "@/lib/calendar/provider";
import { listBookedOnDates } from "@/lib/entries";
import { errorMessage } from "@/lib/errors";
import { listJobs } from "@/lib/jobs";
import { getMeetingDefaultJob, getMeetingExcludeRules, getMeetingJobRules, getReportSettings } from "@/lib/report";
import { getUiOpen } from "@/lib/ui-state";
import type { UiOpenState } from "@/lib/ui-state-shared";
import { currentWeek, formatWeekRange, resolveWeek, shiftWeek } from "@/lib/week";

export const metadata: Metadata = { title: "Import meetings" };

const REASON_LABEL: Record<ExclusionReason, string> = {
  "all-day": "all-day",
  cancelled: "cancelled",
  declined: "declined",
  "not-finished": "not finished yet",
  "outside-range": "outside the week",
  "too-long": "longer than a day",
  "no-title": "without a title (working location)",
};

export default async function ImportPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; error?: string }>;
}) {
  await connection();
  // A plugin's page: there while it's installed.
  if (!isInstalled("outlook-calendar")) return <PluginNotInstalled id="outlook-calendar" />;
  const sp = await searchParams;
  const week = resolveWeek(sp.week) ?? currentWeek();
  const status = getCalendarStatus();

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (/^(localhost|127\.0\.0\.1)/.test(host) ? "http" : "https");
  const origin = `${proto}://${host}`;
  const ingestUrl = `${origin}/api/calendar/ingest`;
  const bookmarklet = buildBookmarklet(`${origin}/import`);
  const copyBookmarklet = buildCopyBookmarklet();

  const prev = shiftWeek(week, -1);
  const next = shiftWeek(week, 1);
  const ui = await getUiOpen();

  return (
    <div className="page">
      <div className="page-aside">
        <div>
          <Link href={`/?week=${week.key}`} className="text-sm text-zinc-500 hover:underline">← Weekly report</Link>
          <h1 className="text-lg font-semibold">Import meetings</h1>
          <p className="text-sm text-zinc-500">
            Pull finished meetings from your Outlook / Teams calendar and book them as time entries.
            Cancelled, all-day and future meetings are skipped; ones already imported are marked.
          </p>
        </div>
        {status.account && !status.fixture && (
          <form action={disconnectCalendarAction} className="text-right">
            <div className="text-sm">{status.account.name ?? status.account.email}</div>
            <div className="text-xs text-zinc-500">{status.account.email}</div>
            <SubmitButton className="btn btn-sm mt-1" pendingText="…" confirm="Disconnect the Outlook account?">Disconnect</SubmitButton>
          </form>
        )}
      </div>

      <HashIngest />

      {sp.error && (
        <p className="alert-error">
          {sp.error === "use-device-code"
            ? "That sign-in method needs a custom app registration. Use the bookmarklet below instead."
            : sp.error}
        </p>
      )}

      <LoadFromOutlook
        bookmarklet={bookmarklet}
        copyBookmarklet={copyBookmarklet}
        ingestUrl={ingestUrl}
        inboxCount={status.inboxCount}
        fixture={status.fixture}
        ui={ui}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link className="btn btn-sm" href={`/import?week=${prev.key}`}>← {prev.key}</Link>
          <div className="text-sm font-medium">Week {week.week} · {formatWeekRange(week)}</div>
          <Link className="btn btn-sm" href={`/import?week=${next.key}`}>{next.key} →</Link>
          {week.key !== currentWeek().key && (
            <Link className="btn btn-sm" href="/import">This week</Link>
          )}
        </div>
      </div>

      {status.source === "none" ? (
        <p className="text-sm text-zinc-500">
          No meetings loaded yet. Run the bookmarklet in your Outlook calendar tab, then this week&apos;s
          meetings appear here to review and book.
        </p>
      ) : (
        <Preview weekKey={week.key} from={week.startIso} to={week.endIso} reportedBy={status.account?.name ?? ""} />
      )}
    </div>
  );
}

function LoadFromOutlook({
  bookmarklet,
  copyBookmarklet,
  ingestUrl,
  inboxCount,
  fixture,
  ui,
}: {
  bookmarklet: string;
  copyBookmarklet: string;
  ingestUrl: string;
  inboxCount: number;
  fixture: boolean;
  ui: UiOpenState;
}) {
  return (
    <section className="card space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-zinc-500 uppercase">Load from Outlook</h2>
        <span className="text-xs text-zinc-500">
          {fixture ? "fixture mode active" : `${inboxCount} meeting${inboxCount === 1 ? "" : "s"} in inbox`}
          {inboxCount > 0 && !fixture && (
            <form action={clearInboxAction} className="ml-2 inline">
              <SubmitButton className="btn btn-sm" pendingText="…">Clear</SubmitButton>
            </form>
          )}
        </span>
      </div>

      <p className="text-sm text-zinc-500">
        No app registration or admin consent needed. Your browser (which is signed in to Outlook)
        grabs the meetings and hands them to Zeff — nothing leaves your machine.
      </p>

      <ol className="list-decimal space-y-2 pl-5 text-sm">
        <li>
          Drag this button to your bookmarks bar (once):{" "}
          <BookmarkletButton href={bookmarklet} label="📅 Zeff: import meetings" className="btn btn-primary btn-sm align-middle" />
        </li>
        <li>
          Open <a className="underline" href="https://outlook.office.com/calendar/view/week" target="_blank" rel="noreferrer">outlook.office.com</a> in <strong>Week view</strong>, go to the week you want, and click the bookmark. It sends that week&apos;s meetings to Zeff.
        </li>
        <li>Come back here — the meetings show up below to review and book. Repeat per week.</li>
      </ol>

      <PersistentDetails name="import-paste" ui={ui} className="text-sm">
        <summary className="cursor-pointer text-zinc-500">Bookmarklet blocked or offline? Use copy &amp; paste</summary>
        <div className="mt-3 space-y-3">
          <p className="text-zinc-500">
            Drag this instead — it copies the meetings to your clipboard:{" "}
            <BookmarkletButton href={copyBookmarklet} label="📋 Zeff: copy meetings" className="btn btn-sm align-middle" />
          </p>
          <PasteEventsForm />
          <p className="text-xs text-zinc-400">
            The bookmarklet posts to <code className="code">{ingestUrl}</code>.
          </p>
        </div>
      </PersistentDetails>

      <PersistentDetails name="import-signin" ui={ui} className="text-sm">
        <summary className="cursor-pointer text-zinc-500">Have a Microsoft app registration? Sign in directly</summary>
        <div className="mt-3">
          <DeviceCodeConnect />
        </div>
      </PersistentDetails>
    </section>
  );
}

async function Preview({ weekKey, from, to, reportedBy }: { weekKey: string; from: string; to: string; reportedBy: string }) {
  const week = resolveWeek(weekKey)!;
  let plan;
  try {
    const events = await getWeekEvents(week);
    const booked = listBookedOnDates(events.map((e) => e.start.dateTime.slice(0, 10)));
    const excludeRules = getMeetingExcludeRules(getReportSettings());
    plan = planImport(events, { from, to, now: new Date(), booked, excludeRules });
  } catch (err) {
    return <p className="alert-error">Could not load the calendar: {errorMessage(err)}</p>;
  }

  const counts = new Map<ExclusionReason, number>();
  for (const x of plan.excluded) counts.set(x.reason, (counts.get(x.reason) ?? 0) + 1);
  const settings = getReportSettings();

  return (
    <>
      <section className="card p-4">
        <MeetingImportForm
          weekKey={weekKey}
          meetings={plan.meetings}
          jobs={listJobs()}
          jobRules={getMeetingJobRules(settings)}
          otherMeetingsJob={getMeetingDefaultJob(settings)}
          defaultReportedBy={reportedBy}
        />
      </section>
      {plan.excluded.length > 0 && (
        <p className="text-xs text-zinc-500">
          Not shown for this week: {[...counts].map(([r, n]) => `${n} ${REASON_LABEL[r]}`).join(", ")}.
        </p>
      )}
    </>
  );
}
