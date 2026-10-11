import { getPref, setPref } from "@/lib/prefs";
import type { SyncKey, SyncView } from "./shared";

/**
 * How the syncs hold up over time — not just their last run: since when one fails, how often in a
 * row. A browser driver whose page changed (WhatsApp, Keep, Teams …) fails on every run from then
 * on; a network blip once. Kept per account (a pref), noted after each run through the registry.
 */

type Health = { failures: number; failingSince: string | null; lastOkAt: string | null; message: string | null };
const PREF = "sync-health";

const read = () => getPref<Partial<Record<SyncKey, Health>>>(PREF, {});

/** A step's run, as it went. */
export function noteSyncResult(key: SyncKey, ok: boolean, message: string | null, at = new Date().toISOString()): void {
  const all = read();
  const was = all[key] ?? { failures: 0, failingSince: null, lastOkAt: null, message: null };
  all[key] = ok
    ? { failures: 0, failingSince: null, lastOkAt: at, message: null }
    : { failures: was.failures + 1, failingSince: was.failingSince ?? at, lastOkAt: was.lastOkAt, message: message?.slice(0, 300) ?? null };
  setPref(PREF, all);
}

/** login: wants you to sign in · chrome: the automation Chrome isn't running · broken: anything else (a changed page, say). */
export type ProblemKind = "login" | "chrome" | "broken";

export type SyncProblem = { key: SyncKey; label: string; href: string; kind: ProblemKind; failures: number; since: string; lastOkAt: string | null; message: string };

export function problemKind(message: string): ProblemKind {
  // The Chrome first: its messages say "sign in … if asked" too (scripts/chrome-cdp.mjs).
  if (/chrome (isn't running|has no window)|isn't responding|debug port|ECONNREFUSED|chrome läuft nicht/i.test(message)) return "chrome";
  if (/sign[- ]?in|signed in|log ?in|anmelden|angemeldet|verknüpf|QR/i.test(message)) return "login";
  return "broken";
}

/** Failing this many runs in a row, or for this long, is a problem — once is a blip. */
const RUNS = 2;
const HOURS = 12;

/** The syncs that keep failing (of the steps there are, not running right now): longest first. */
export function syncProblems(steps: Pick<SyncView, "key" | "label" | "href" | "running">[], now = Date.now()): SyncProblem[] {
  const all = read();
  const out: SyncProblem[] = [];
  for (const s of steps) {
    const h = all[s.key];
    if (!h?.failures || !h.failingSince || s.running) continue;
    if (h.failures < RUNS && now - Date.parse(h.failingSince) < HOURS * 3600e3) continue;
    const message = h.message ?? "";
    out.push({ key: s.key, label: s.label, href: s.href, kind: problemKind(message), failures: h.failures, since: h.failingSince, lastOkAt: h.lastOkAt, message });
  }
  return out.sort((a, b) => a.since.localeCompare(b.since));
}
