import { t } from "@/lib/i18n/server";
import { STEPS } from "@/lib/learning/ledger";
import type { ProposalSource } from "@/lib/proposals/point";
import { DAY_PLAN_KEY, keepProposedEvent, PROPOSAL_SOURCE, proposedEventId, removeProposedEvent, syncAllProposals, type ProposedPayload } from "@/lib/calendar/proposed";

/**
 * What the Calendar proposes through the one proposals store (@/lib/proposals): the proposed appointments of any calendar — the
 * day plan's blocks, what an assistant planned in a page (lib/calendar/proposed keeps them as proposals). Accepted: an appointment
 * like any other (in a Google calendar: written there; Outlook's is read-only — Zeff's own calendar instead); dismissed: taken
 * out, and not proposed again when asked once more. The calendar's buttons and the review queue both decide through `decide()`.
 */

const payloadOf = (p: { payload: unknown }) => p.payload as ProposedPayload;
const when = (x: ProposedPayload) => (x.allDay ? x.start.slice(0, 10) : `${x.start.slice(0, 16).replace("T", " ")}–${x.end.slice(11, 16)}`);

export const CALENDAR_PROPOSALS: ProposalSource[] = [
  {
    id: PROPOSAL_SOURCE,
    step: STEPS.calendarProposal,
    get label() {
      return t("Calendar proposals");
    },
    prepare: () => syncAllProposals(),
    entries: (list) =>
      list.map((p) => {
        const x = payloadOf(p);
        return { title: t("Proposed: {title}", { title: `${x.title} (${when(x)})` }), detail: x.calendar, href: `/kalender?v=day&d=${x.start.slice(0, 10)}` };
      }),
    labels: () => ({ yes: t("Accept"), no: t("Dismiss") }),
    apply: async (p) => {
      const id = proposedEventId(p);
      const ir = await import("@/lib/calendar/ir");
      const e = id ? ir.eventById(id) : null;
      if (!e) throw new Error(t("That appointment is gone."));
      if (e.calendar.source === "zeff") {
        keepProposedEvent(e.id);
        return { message: t("In {calendar} now.", { calendar: e.calendar.name }), ref: `event:${e.id}` };
      }
      if (e.calendar.source === "google") {
        // Written to Google (the copy here comes with its next sync); the proposal taken out.
        const fields = { title: e.title, start: e.start, end: e.end, allDay: e.allDay, location: e.location, description: e.description };
        const r = await (await import("@/lib/google/calendar-write")).insertGcalEvent(e.calendar.key.replace(/^google:/, ""), fields);
        const { journalGoogleWrite } = await import("@/lib/google/journal");
        journalGoogleWrite({ kind: "calendar.created", source: "gcalendar", sourceRef: r.id, title: e.title, summary: `${e.start} – ${e.end}`, url: r.htmlLink });
        removeProposedEvent(e.id);
        return { message: t('"{title}" added to Google Calendar.', { title: e.title }) };
      }
      // (Outlook's calendar is read only: into Zeff's own instead)
      const target = ir.zeffCalendar();
      const made = ir.addEvent(target.id, { title: e.title, start: e.start, end: e.end, allDay: e.allDay, location: e.location, description: e.description, ...(e.recurrence ? { recurrence: e.recurrence } : {}) });
      removeProposedEvent(e.id);
      return { message: t("In {calendar} now.", { calendar: target.name }), ref: `event:${made.id}` };
    },
    dismiss: (p) => {
      const id = proposedEventId(p);
      if (id) removeProposedEvent(id);
      return { message: t("Proposal dismissed.") };
    },
    // The day plan's blocks count for the day plan (whether its order is any good), the others for the calendar's proposals.
    feedback: (p) => {
      const x = payloadOf(p);
      return { ...(String(x.key ?? "").startsWith(DAY_PLAN_KEY) ? { step: STEPS.dayPlan } : {}), detail: { text: x.title, start: x.start, end: x.end, calendar: x.calendar } };
    },
  },
];
