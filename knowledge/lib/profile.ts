import { db } from "./db";

/**
 * What the knowledge knows about its owner as figures (compile.ts reads them off the pages): the net income of a month (from
 * the bank statements, a payslip), the rent … — one figure per key and month, the one of the page compiled last. For the
 * applications (GET /api/profile). Server only.
 */

export type ProfileFact = { key: string; period: string; amount: number; text: string; pageId: string; pageTitle: string; at: string };

/** The figures (of one key, or all), the newest month first — one per key and month. */
export function profileFacts(key?: string): ProfileFact[] {
  const rows = db()
    .prepare(
      `select f.key, f.period, f.amount, f.text, f.page_id pageId, p.title pageTitle, f.at
       from profile_facts f join pages p on p.id = f.page_id
       ${key ? "where f.key = ?" : ""}
       order by f.period desc, f.at desc, f.id desc`,
    )
    .all(...(key ? [key] : [])) as ProfileFact[];
  const seen = new Set<string>();
  return rows.filter((r) => {
    const k = `${r.key}|${r.period}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
