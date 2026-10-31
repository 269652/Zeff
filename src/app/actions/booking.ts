"use server";

import { after } from "next/server";
import { parallelSaid } from "@/lib/entry-parallel";
import { errorMessage } from "@/lib/errors";
import { formatHours } from "@/lib/format";
import { t } from "@/lib/i18n/server";
import { revalidateAll, type ActionState } from "@/app/action-helpers";

/** Feierabend: the day's lines booked as you took them over (meetings, suggestions, tickets). */
export async function bookDayAction(date: string, rows: import("@/lib/feierabend").DayBooking[]): Promise<ActionState | (NonNullable<ActionState> & { created?: import("@/lib/feierabend").BookedStamp[] })> {
  try {
    if (!(await import("@/plugins/state")).isInstalled("zeiterfassung")) return { ok: false, error: t("Time tracking is not installed (Menu → Plugins).") };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) return { ok: false, error: t("Not a day.") };
    const { bookDay } = await import("@/lib/feierabend");
    const r = await bookDay(String(date), Array.isArray(rows) ? rows.slice(0, 60) : []);
    revalidateAll();
    const base = r.skipped
      ? t("{booked} booked ({hours} h), {skipped} already booked", { booked: r.booked, hours: formatHours(r.hours), skipped: r.skipped })
      : t("{booked} booked ({hours} h)", { booked: r.booked, hours: formatHours(r.hours) });
    const itemsSaid = r.items ? `${base}, ${r.items === 1 ? t("1 itemized under the group entry") : t("{n} itemized under the group entry", { n: r.items })}` : base;
    const said = r.parallel ? `${itemsSaid}, ${r.parallel === 1 ? t("1 grouped as parallel work") : t("{n} grouped as parallel work", { n: r.parallel })}` : itemsSaid;
    return r.errors.length ? { ok: false, error: t("{said} — not booked: {errors}", { said, errors: r.errors.join("; ") }), created: r.created } : { ok: true, message: `${said}.`, created: r.created };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Takes a Feierabend booking back: deletes the entries it created, only those still as booked. */
export async function undoBookDayAction(created: { id: number; updatedAt: string }[]): Promise<ActionState> {
  try {
    const list = (Array.isArray(created) ? created : []).slice(0, 60).map((c) => ({ id: Number(c?.id), updatedAt: String(c?.updatedAt) })).filter((c) => Number.isInteger(c.id));
    const { undoBooking } = await import("@/lib/feierabend");
    const r = await undoBooking(list);
    revalidateAll();
    return { ok: true, message: r.kept ? t("{n} taken back, {kept} left (changed since)", { n: r.deleted, kept: r.kept }) : t("{n} taken back", { n: r.deleted }) };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/**
 * A booked entry's context from its todos — after the answer (the Jira read takes a while): the
 * conversations as they are now, then what the todos came from attached.
 */
async function attachContextLater(entryId: number, ticket: string | null, todoIds: number[]) {
  if (!todoIds.length) return;
  try {
    const { attachTodoContext, commentTickets } = await import("@/lib/work/booking");
    const { refreshTicketComments } = await import("@/lib/boards/collect");
    await refreshTicketComments(commentTickets(todoIds)).catch(() => 0);
    attachTodoContext(entryId, ticket, todoIds);
  } catch (e) {
    console.error("[booking context]", errorMessage(e));
  }
}

/** An agent's suggested booking, taken over with the hours and words you settled on (a real entry, its evidence as context). */
export async function acceptSuggestionAction(id: number, edits: { hours?: number; description?: string }): Promise<ActionState> {
  try {
    const { acceptSuggestion } = await import("@/lib/work/suggestions");
    // Booked at once; its context (the conversations as Jira has them now) comes right after.
    const r = acceptSuggestion(Number(id), { hours: edits?.hours === undefined ? undefined : Number(edits.hours), description: edits?.description === undefined ? undefined : String(edits.description) }, { context: false });
    after(() => attachContextLater(r.entryId, r.ticket, r.todoIds));
    revalidateAll();
    return {
      ok: true,
      message: r.parallel
        ? `${r.ticket ? t("Booked {hours} h on {ticket}.", { hours: formatHours(r.hours), ticket: r.ticket }) : t("Booked {hours} h.", { hours: formatHours(r.hours) })} ${parallelSaid(r.parallel)}`
        : r.ticket
        ? t("Booked {hours} h on {ticket}.", { hours: formatHours(r.hours), ticket: r.ticket })
        : t("Booked {hours} h.", { hours: formatHours(r.hours) }),
    };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** An agent's suggested booking, not to be booked. */
export async function skipSuggestionAction(id: number): Promise<ActionState> {
  try {
    const { skipSuggestion } = await import("@/lib/work/suggestions");
    skipSuggestion(Number(id));
    revalidateAll();
    return { ok: true, message: t("Suggestion dismissed.") };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** A ticket's todos done today, booked as one entry with the hours and words you settled on (Weekly report) — or skipped. */
export async function bookDoneTodayAction(v: { ticket: string; todoIds: number[]; hours: number; description: string; skip?: boolean }): Promise<ActionState> {
  try {
    const { bookDoneToday } = await import("@/lib/work/booking");
    // Booked at once; its context (the conversations as Jira has them now) comes right after.
    const r = bookDoneToday({ ticket: String(v.ticket), todoIds: Array.isArray(v.todoIds) ? v.todoIds : [], hours: Number(v.hours), description: String(v.description ?? ""), skip: !!v.skip, context: false });
    if (r.entryId) {
      const entryId = r.entryId;
      after(() => attachContextLater(entryId, String(v.ticket), r.todoIds));
    }
    revalidateAll();
    return {
      ok: true,
      message: v.skip
        ? t("{ticket}: not suggested any more.", { ticket: v.ticket })
        : t("Booked {hours} h on {ticket}.", { hours: formatHours(r.hours), ticket: v.ticket }),
    };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
