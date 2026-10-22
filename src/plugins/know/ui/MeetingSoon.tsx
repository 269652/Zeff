import { formatTime } from "@/lib/format";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import { KnowPanel } from "./KnowPanel";

/** How long before a meeting Today shows its brief, and how long after it began still. */
const BEFORE_MINUTES = 45;
const AFTER_MINUTES = 10;

/**
 * Today's "before your meeting" (the know plugin, with the Calendar): the next meeting with someone you know in it that starts
 * within the next 45 minutes (or began up to 10 minutes ago) — its brief, the AI's points when they were made with the briefing.
 * Nothing otherwise. Server component; `now` from the page (the clock is read there).
 */
export async function MeetingSoon({ now }: { now: number }) {
  if (!isInstalled("know") || !isInstalled("calendar")) return null;
  let next: { id: number; occurrence: string | null; title: string; start: string } | undefined;
  try {
    const { upcomingMeetings } = await import("../brief");
    next = upcomingMeetings({ now: new Date(now), withinMinutes: BEFORE_MINUTES, startedMinutes: AFTER_MINUTES })[0];
  } catch (e) {
    console.error("[know] the next meeting", e);
  }
  if (!next) return null;
  return <KnowPanel event={next.id} occurrence={next.occurrence ?? undefined} title={t("Before “{title}” at {time}", { title: next.title || t("(no title)"), time: formatTime(next.start) })} showEmpty />;
}
