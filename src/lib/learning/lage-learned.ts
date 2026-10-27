/**
 * What your decisions on the briefing's todos teach it, across tickets: the kinds you mostly drop (a "test" todo for a
 * branch nobody asked to test, a "merge" todo for someone else's MR …) with a few of them as examples — for its prompt, so
 * it makes them only when they're clearly yours. Only your own decisions count (you ticked it off or dropped it), not the
 * ones a rule or a run made. The per-ticket history ("dropped on …, don't make it again") stays where it is (collect.ts).
 * Server only.
 */
import { getSqlite } from "@/db";

/** The last this many days. */
const DAYS = 60;
/** A kind counts once you decided on this many of it… */
const MIN = 6;
/** …and dropped at least this share of them. */
const SHARE = 0.4;
const EXAMPLES = 3;

export type KindVerdict = { kind: string; done: number; dropped: number; examples: string[] };

/** Per kind of the briefing's todos (those on a ticket): how many you ticked off and dropped lately, the dropped ones' words. */
export function lageVerdicts(now = Date.now()): KindVerdict[] {
  const since = new Date(now - DAYS * 864e5).toISOString();
  let rows: { kind: string; event: string; text: string }[] = [];
  try {
    rows = getSqlite()
      .prepare(
        `select t.kind kind, e.event event, t.text text from todo_events e join todos t on t.id = e.todo_id
         where e.event in ('done', 'dismissed') and e.actor = 'you' and e.at >= ? and t.ticket != '' order by e.at desc`,
      )
      .all(since) as typeof rows;
  } catch {
    return [];
  }
  const by = new Map<string, KindVerdict>();
  for (const r of rows) {
    const v = by.get(r.kind) ?? { kind: r.kind, done: 0, dropped: 0, examples: [] };
    if (r.event === "done") v.done++;
    else {
      v.dropped++;
      if (v.examples.length < EXAMPLES) v.examples.push(r.text.replace(/\s+/g, " ").trim().slice(0, 140));
    }
    by.set(r.kind, v);
  }
  return [...by.values()].sort((a, b) => b.dropped + b.done - (a.dropped + a.done));
}

/** The kinds you mostly drop (enough decided, a large enough share dropped). */
export const droppedKinds = (verdicts: KindVerdict[]): KindVerdict[] => verdicts.filter((v) => v.done + v.dropped >= MIN && v.dropped / (v.done + v.dropped) >= SHARE);

/** The prompt's block (German, as the prompts are); none when nothing stands out. */
export function lageLearnedBlock(now = Date.now()): string[] {
  const kinds = droppedKinds(lageVerdicts(now));
  if (!kinds.length) return [];
  return [
    `# Gelernt aus meinen Entscheidungen (letzte ${DAYS} Tage, über alle Tickets)`,
    "",
    "Diese Arten von Todos verwerfe ich meistens — leg eine davon nur an, wenn eindeutig ich dran bin und es ohne mich nicht weitergeht (sonst lieber in die Zusammenfassung des Tickets):",
    ...kinds.map((v) => `- „${v.kind}“: ${v.dropped} von ${v.done + v.dropped} verworfen — z. B. ${v.examples.map((e) => `„${e}“`).join("; ")}`),
  ];
}
