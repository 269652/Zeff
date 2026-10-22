/**
 * Source health on the Timeline page (lib/sync/source-health): the timeline is only as complete as the sources it reads — a
 * source whose sync is stale, silent, failing or broken brings nothing new, and the page says so in one line. Each of the
 * timeline's sources by the sync steps that bring it. Server only.
 */
import { t } from "@/lib/i18n/server";
import { healthLabel, type SourceHealth } from "@/lib/sync/source-health-shared";

/** The sync steps that bring a timeline source (sources without one — time, todos, the Workspace — are Zeff's own). */
export const SOURCE_STEPS: Record<string, string[]> = {
  mail: ["mail"],
  whatsapp: ["whatsapp"],
  signal: ["signal"],
  teams: ["teams"],
  jira: ["jira"],
  gitlab: ["gitlab"],
  calendar: ["calendar", "gcalendar"],
};

/** One line naming the steps of these sources that aren't well (null: all are, or none is known). */
export function timelineHealthNote(health: Pick<SourceHealth, "key" | "label" | "state">[], sources: string[]): string | null {
  const steps = new Set(sources.flatMap((s) => SOURCE_STEPS[s] ?? []));
  const bad = health.filter((h) => steps.has(h.key) && h.state !== "ok");
  if (!bad.length) return null;
  return t("{sources} — the timeline may miss what they brought lately.", { sources: bad.map((h) => `${h.label} (${healthLabel(t, h.state)})`).join(", ") });
}

