/**
 * What the briefing doesn't know: the sources it reads that aren't well as it runs (failing, stale, silent, drift —
 * lib/sync/source-health) — re-synced first when it's started by hand, and what is still wrong said in its prompt (so a
 * missing reply isn't read as "no answer yet") and under its lede. Server only.
 */
import { translator } from "@/lib/i18n/shared";
import { healthLabel, healthReason, type SourceHealth } from "@/lib/sync/source-health-shared";

/** The sources' health now (fresh), those of `keys` that aren't well; none when it can't be judged. */
export async function sourceGaps(keys: readonly string[]): Promise<SourceHealth[]> {
  try {
    const { sourceHealth } = await import("@/lib/sync/source-health");
    const want = new Set(keys);
    return (await sourceHealth({ fresh: true })).filter((h) => want.has(h.key) && h.state !== "ok");
  } catch {
    return [];
  }
}

const de = translator("de");
const stamp = (iso: string | null) => (iso ? new Date(iso).toLocaleString("de-DE", { weekday: "short", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" }) : null);

/** For the prompt (German, as the prompts are): one line each — what is wrong, why, its newest item. */
export function gapLines(gaps: SourceHealth[]): string[] {
  return gaps.map((h) => `- ${h.label}: ${healthLabel(de, h.state)} — ${healthReason(de, h)}${h.lastNewAt ? ` (Neuestes von dort: ${stamp(h.lastNewAt)})` : ""}`);
}

/** The prompt's notice; none when all are well. */
export function gapNotice(gaps: SourceHealth[]): string[] {
  if (!gaps.length) return [];
  return [
    "ACHTUNG — diese Quellen sind bei diesem Lauf nicht aktuell:",
    ...gapLines(gaps),
    "Was sie zuletzt gebracht hätten, kann fehlen: werte fehlende Antworten oder Nachrichten von dort nicht als „noch nicht beantwortet“ oder „nichts passiert“, schließ deswegen nichts als erledigt oder verworfen, und sag die Lücke im Lede in einem kurzen Halbsatz.",
  ];
}
