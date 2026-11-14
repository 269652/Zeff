import "@/plugins/contributions";
import "./register";
import { errorMessage } from "@/lib/errors";
import { visibleSeries } from "./boundaries";
import { correlationSeries, type Series, type SeriesInfo, type SeriesRange } from "./series-point";

/**
 * Every installed plugin's daily series for a period, and one of them found by its database's and field's name — only those the
 * reader may see (boundaries.ts: secret for nobody, personal for you and agents allowed it). Server only.
 */

/** All series of the period; a provider that fails is left out (and logged), the others still count. */
export async function allSeries(range: SeriesRange): Promise<Series[]> {
  const out: Series[] = [];
  const seen = new Set<string>();
  for (const c of correlationSeries.list())
    for (const p of c.impl) {
      try {
        for (const s of await p.series(range)) if (!seen.has(s.id)) (seen.add(s.id), out.push(s));
      } catch (e) {
        console.warn(`[correlations] ${p.id}: ${errorMessage(e)}`);
      }
    }
  return visibleSeries(out);
}

/** Every series the installed plugins offer, without values (quick) — your databases' fields first. */
export function seriesCatalog(): SeriesInfo[] {
  const out: SeriesInfo[] = [];
  for (const c of correlationSeries.list())
    for (const p of c.impl) {
      try {
        out.push(...(p.catalog?.() ?? []));
      } catch (e) {
        console.warn(`[correlations] ${p.id}: ${errorMessage(e)}`);
      }
    }
  return visibleSeries(out);
}

// (Pure, in find.ts: the plugin's lambdas bundle it too.)
export { findSeries } from "./find";
