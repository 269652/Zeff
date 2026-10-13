import { isoDay } from "@/lib/text";
/**
 * Remembered open/closed state of the app's expandable sections (report days & lines,
 * collapsible panels). It lives in one cookie so the server renders every section the way
 * it was left — no collapse-then-expand flash on reload. Only states that differ from a
 * section's default are stored. Server-free: shared by client components and the server.
 */
export const UI_OPEN_COOKIE = "zeff_open";

export type UiOpenState = Record<string, 0 | 1>;

export function parseUiOpen(raw: string | null | undefined): UiOpenState {
  if (!raw) return {};
  try {
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    const out: UiOpenState = {};
    for (const [k, x] of Object.entries(v)) if (x === 0 || x === 1) out[k] = x;
    return out;
  } catch {
    return {};
  }
}

export function isOpen(state: UiOpenState, key: string, defaultOpen = false): boolean {
  const v = state[key];
  return v === undefined ? defaultOpen : v === 1;
}

/** 32-bit FNV-1a in base36 — keeps report-line keys (rendered labels) short in the cookie. */
function shortHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export const uiKey = {
  /** A fixed collapsible panel, e.g. "week-entries". */
  section: (name: string) => `s:${name}`,
  /** A day in the weekly report. */
  day: (date: string) => `d:${date}`,
  /** A line in the weekly report (its group key is hashed). */
  line: (date: string, lineKey: string) => `l:${date}:${shortHash(lineKey)}`,
};

const MAX_COOKIE_CHARS = 3000; // browsers cap a cookie at ~4 KB
const KEEP_DAYS = 45;

function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return isoDay(d);
}

const encode = (entries: [string, 0 | 1][]) => encodeURIComponent(JSON.stringify(Object.fromEntries(entries)));

/** Drop report day/line states older than KEEP_DAYS, then the oldest dated ones until the cookie fits. */
function prune(state: UiOpenState): [string, 0 | 1][] {
  const dateOf = (k: string) => /^[dl]:(\d{4}-\d{2}-\d{2})/.exec(k)?.[1] ?? null;
  const cutoff = isoDaysAgo(KEEP_DAYS);
  let kept = Object.entries(state).filter(([k]) => (dateOf(k) ?? cutoff) >= cutoff);
  const oldestFirst = kept
    .map(([k]) => k)
    .filter((k) => dateOf(k))
    .sort((a, b) => dateOf(a)!.localeCompare(dateOf(b)!));
  while (encode(kept).length > MAX_COOKIE_CHARS && oldestFirst.length) {
    const drop = oldestFirst.shift();
    kept = kept.filter(([k]) => k !== drop);
  }
  return kept;
}

/** Browser only: remember that `key` was left open/closed (forgotten again when it matches the default). */
export function rememberOpen(key: string, open: boolean, defaultOpen = false): void {
  if (typeof document === "undefined") return;
  const raw = document.cookie
    .split("; ")
    .find((c) => c.startsWith(`${UI_OPEN_COOKIE}=`))
    ?.slice(UI_OPEN_COOKIE.length + 1);
  let state: UiOpenState = {};
  try {
    state = parseUiOpen(raw ? decodeURIComponent(raw) : null);
  } catch {
    state = {};
  }
  if (open === defaultOpen) delete state[key];
  else state[key] = open ? 1 : 0;
  document.cookie = `${UI_OPEN_COOKIE}=${encode(prune(state))}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
}
