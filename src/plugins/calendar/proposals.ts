import { t } from "@/lib/i18n/server";
import { STEPS } from "@/lib/learning/ledger";
import type { ProposalSource } from "@/lib/proposals/point";
import { removeShadowEvent, SHADOW_SOURCE, shadowEventId, syncAllShadowProposals, type ShadowPayload } from "@/lib/calendar/shadow-proposals";

/**
 * What the Calendar proposes through the one proposals store (@/lib/proposals): the appointments of the shadow calendars — the
 * day plan's blocks, what a page planned (lib/calendar/shadow-proposals keeps them as proposals). Accepted: entered in your own
 * calendar (Zeff's) and taken out of the shadow calendar; dismissed: taken out, and not proposed again when the day is planned
 * once more. The calendar's buttons and the review queue both decide through `decide()`.
 */

const payloadOf = (p: { payload: unknown }) => p.payload as ShadowPayload;
const when = (x: ShadowPayload) => (x.allDay ? x.start.slice(0, 10) : `${x.start.slice(0, 16).replace("T", " ")}–${x.end.slice(11, 16)}`);

export const CALENDAR_PROPOSALS: ProposalSource[] = [
  {
    id: SHADOW_SOURCE,
    step: STEPS.shadowCalendar,
    get label() {
      return t("Shadow calendars");
    },
    prepare: () => syncAllShadowProposals(),
    entries: (list) =>
      list.map((p) => {
        const x = payloadOf(p);
        return { title: t("Proposed: {title}", { title: `${x.title} (${when(x)})` }), detail: x.calendar, href: `/kalender?v=day&d=${x.start.slice(0, 10)}` };
      }),
    labels: () => ({ yes: t("Accept"), no: t("Dismiss") }),
    apply: async (p) => {
      const id = shadowEventId(p);
      const ir = await import("@/lib/calendar/ir");
      const e = id ? ir.eventById(id) : null;
      if (!e || !e.calendar.shadow) throw new Error(t("That appointment is gone."));
      const target = ir.zeffCalendar();
      const made = ir.addEvent(target.id, { title: e.title, start: e.start, end: e.end, allDay: e.allDay, location: e.location, description: e.description, ...(e.recurrence ? { recurrence: e.recurrence } : {}) });
      removeShadowEvent(e.id);
      return { message: t("In {calendar} now.", { calendar: target.name }), ref: `event:${made.id}` };
    },
    dismiss: (p) => {
      const id = shadowEventId(p);
      if (id) removeShadowEvent(id);
      return { message: t("Taken out of the shadow calendar.") };
    },
    // The day plan's blocks count for the day plan (whether its order is any good), the others for the shadow calendars.
    feedback: (p) => {
      const x = payloadOf(p);
      return { ...(p.kind === "day-plan-block" ? { step: STEPS.dayPlan } : {}), detail: { text: x.title, start: x.start, end: x.end, calendar: x.calendar } };
    },
  },
];
