"use server";

import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import type { ShownEvent } from "./query";

/** The Timeline plugin's server actions: an entity's events (by ref or a row), the whole timeline, "seen now". */

export type TimelineQuery = { ref?: string; row?: number; kinds?: string[]; sources?: string[]; since?: string; limit?: number; before?: { at: string; id: number } };
export type TimelineAnswer = { ok: true; label: string; refs: string[]; events: ShownEvent[]; lastSeen: string | null } | { ok: false; error: string; /** The plugin is off. */ off?: boolean };

const off = () => (isInstalled("timeline") ? null : t("The Timeline plugin is not installed (Menu → Plugins)."));
const LIMIT = 200;

/** The events of an entity (`ref`) or of a Workspace row (`row`: the row, the person or case it is), or all of them (neither). */
export async function timelineAction(q: TimelineQuery): Promise<TimelineAnswer> {
  try {
    const no = off();
    if (no) return { ok: false, error: no, off: true };
    const { timelineFor, timelineAll } = await import("./query");
    const { lastSeen } = await import("./store");
    const limit = Math.max(1, Math.min(LIMIT, Number(q.limit) || 30));
    // What happened, not what is coming: nothing later than now (an appointment next week isn't an event yet).
    const until = new Date().toISOString();
    if (!q.ref && !q.row) return { ok: true, label: t("Timeline"), refs: [], events: timelineAll({ kinds: q.kinds, sources: q.sources, since: q.since, until, limit, before: q.before }), lastSeen: lastSeen("all") };
    const r = timelineFor({ ref: q.ref, row: q.row ? Number(q.row) : undefined, kinds: q.kinds, sources: q.sources, since: q.since, until, limit, before: q.before });
    return r.ok ? r : { ok: false, error: r.error };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

/** You looked at it now: its "new since your last visit" starts from here next time. `ref` "all": the Timeline page. */
export async function markTimelineSeenAction(ref: string): Promise<{ ok: boolean }> {
  try {
    if (off() || !ref) return { ok: false };
    (await import("./store")).markSeen(String(ref).slice(0, 300));
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
