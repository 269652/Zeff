/**
 * Breaks ("Pausen") as local "HH:MM" ranges. Server-free, so the Pause cell editor can
 * parse and preview input while typing and the server validates it the same way.
 */
export type PauseRange = { start: string; end: string };

/** `none`: the day explicitly had no break (so no default break applies either). */
export type ParsedPauses = { ok: true; pauses: PauseRange[]; none?: boolean } | { ok: false; error: string };

/** Typed for "no break that day": 0, none, no break, keine (Pause), ohne (Pause). */
const NO_BREAK = /^(?:0|none|no(?:\s*break)?|keine(?:\s*pause)?|ohne(?:\s*pause)?)$/i;

const pad = (n: number) => String(n).padStart(2, "0");

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function fromMinutes(min: number): string {
  return `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
}

/** The last minute of the day a break can end at. */
const DAY_END = 23 * 60 + 59;

export function pauseMinutes(p: PauseRange): number {
  return toMinutes(p.end) - toMinutes(p.start);
}

export function totalPauseHours(pauses: PauseRange[]): number {
  return pauses.reduce((a, p) => a + pauseMinutes(p), 0) / 60;
}

/** "12:00-12:30, 15:00-15:10" — the editor's text for a day's breaks. */
export function formatPauses(pauses: PauseRange[]): string {
  return pauses.map((p) => `${p.start}-${p.end}`).join(", ");
}

/** "12", "12:30", "12.30", "1230", "930" → "HH:MM"; undefined if it isn't a time of day. */
export function parseTime(raw: string): string | undefined {
  const s = raw.trim();
  const m = /^(\d{1,2})(?:[:.](\d{2}))?$/.exec(s) ?? /^(\d{1,2})(\d{2})$/.exec(s);
  if (!m) return undefined;
  const h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  return h <= 23 && min <= 59 ? `${pad(h)}:${pad(min)}` : undefined;
}

/** "30m", "45 min", "1h", "1,5h", "1h30" → minutes; a bare number ("30") counts as minutes. */
export function parseDuration(raw: string): number | undefined {
  const s = raw.trim().toLowerCase().replace(",", ".");
  let m = /^(\d+)$/.exec(s) ?? /^(\d+(?:\.\d+)?)\s*(?:m|min|mins|minuten|minutes)$/.exec(s);
  if (m) return Math.round(Number(m[1]));
  m = /^(\d+(?:\.\d+)?)\s*(?:h|std|stunden?|hours?)$/.exec(s);
  if (m) return Math.round(Number(m[1]) * 60);
  m = /^(\d+)\s*h\s*(\d{1,2})\s*(?:m|min)?$/.exec(s);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  return undefined;
}

/** A start time plus minutes, kept within the day. */
function span(start: string, minutes: number): PauseRange | string {
  if (minutes <= 0) return "A break needs a length.";
  const end = toMinutes(start) + minutes;
  if (end > 23 * 60 + 59) return "The break runs past midnight.";
  return { start, end: fromMinutes(end) };
}

function parseSegment(seg: string, defaultStart: string): PauseRange | string | undefined {
  // "12:00-12:30", "12 – 12.30", "12:00 bis 12:30" (or a length after the dash: "12-30m", "12-45")
  let m = /^(\S+?)\s*(?:-|–|—|\bbis\b|\bto\b)\s*(\S+)$/i.exec(seg);
  if (m) {
    const start = parseTime(m[1]);
    const end = parseTime(m[2]);
    if (start && end) {
      return toMinutes(end) > toMinutes(start) ? { start, end } : `The break ends before it starts (${start}–${end}).`;
    }
    const length = start ? parseDuration(m[2]) : undefined;
    return start && length !== undefined ? span(start, length) : undefined;
  }
  // "30m", "45", "1h": a length starting at the usual time
  const minutes = parseDuration(seg);
  if (minutes !== undefined) return span(defaultStart, minutes);
  // "12:00 30m", "12+45", "12:15 + 1h"
  m = /^(\S+?)\s*(?:\+|\s)\s*(.+)$/.exec(seg);
  if (m) {
    const start = parseTime(m[1]);
    const length = parseDuration(m[2]);
    if (start && length !== undefined) return span(start, length);
  }
  return undefined;
}

/** The breaks in a text: separated by ";", a newline or "," (except a decimal comma in a length, "1,5h"). */
function segmentsOf(text: string): string[] {
  return text
    .split(/\s*(?:;|\n|,(?!\d+\s*(?:h|std|m|min)\b))\s*/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Give a break a new length, keeping its start (moved earlier only if it would pass midnight). */
export function withLength(p: PauseRange, minutes: number): PauseRange {
  const start = Math.max(0, Math.min(toMinutes(p.start), DAY_END - minutes));
  return { start: fromMinutes(start), end: fromMinutes(start + minutes) };
}

// ---------------------------------------------------------------------------
// Locked length while editing the text: change a break's start and its end follows
// (or the other way round), so a 1 h break stays 1 h.
// ---------------------------------------------------------------------------

type TimeToken = { from: number; to: number; text: string };
type BreakSeg =
  | { kind: "range"; start: number; end: number; startTok: TimeToken; endTok: TimeToken }
  | { kind: "other" }
  | { kind: "invalid" };
type BreakLock = { field: "start" | "end"; length: number } | null;

/** What the text looked like after the last edit, and which breaks have a locked length. */
export type BreakEditState = { segs: BreakSeg[]; locks: BreakLock[] };

/** "12:00-13:00" with the separator captured, so the two times can be rewritten in place. */
const RANGE_PARTS = /^(\S+?)(\s*(?:-|–|—|\bbis\b|\bto\b)\s*)(\S+)$/i;
/** A finished time ("12:30", "12.30", "1230", "930") — not "12" that may still become "12:30". */
const COMPLETE_TIME = /^(?:\d{1,2}[:.]\d{2}|\d{3,4})$/;

/** The breaks in a text with their offsets (same separators as segmentsOf). */
function segmentSpans(text: string): { from: number; text: string }[] {
  const out: { from: number; text: string }[] = [];
  const push = (from: number, to: number) => {
    const raw = text.slice(from, to);
    const trimmed = raw.trim();
    if (trimmed) out.push({ from: from + (raw.length - raw.trimStart().length), text: trimmed });
  };
  const sep = /\s*(?:;|\n|,(?!\d+\s*(?:h|std|m|min)\b))\s*/gi;
  let last = 0;
  for (let m = sep.exec(text); m; m = sep.exec(text)) {
    push(last, m.index);
    last = m.index + m[0].length;
  }
  push(last, text.length);
  return out;
}

/**
 * Each break of the text: a "range" when both times can be read — even if the end is
 * (still) before the start, so a lock can repair that — else "other" (a length form like
 * "12:00 30m") or "invalid" (mid-typing).
 */
function readSegments(text: string, defaultStart: string): BreakSeg[] {
  return segmentSpans(text).map((seg) => {
    const m = RANGE_PARTS.exec(seg.text);
    const start = m ? parseTime(m[1]) : undefined;
    const end = m ? parseTime(m[3]) : undefined;
    if (m && start && end) {
      const endFrom = seg.from + m[1].length + m[2].length;
      return {
        kind: "range" as const,
        start: toMinutes(start),
        end: toMinutes(end),
        startTok: { from: seg.from, to: seg.from + m[1].length, text: m[1] },
        endTok: { from: endFrom, to: endFrom + m[3].length, text: m[3] },
      };
    }
    const p = parseSegment(seg.text, defaultStart);
    return !p || typeof p === "string" ? { kind: "invalid" as const } : { kind: "other" as const };
  });
}

export function initBreakEdit(text: string, defaultStart = "12:00"): BreakEditState {
  return { segs: readSegments(text, defaultStart), locks: [] };
}

/**
 * Apply one edit of the break text with locked lengths: when a break's start changed and
 * its end didn't (or vice versa), the other time is rewritten so the length stays.
 * - A time only counts once it's finished ("14:30", not "1" or "14" on the way there).
 * - Only a finished time that was edited locks — typing a new break "12:30-13" → "12:30-13:15"
 *   is taken as typed; once locked, further edits of that time keep moving the break.
 * - Retyping both times, or text that can't be read yet, is left alone.
 * Returns the text, the caret (shifted when a time before it was rewritten) and the state
 * for the next edit.
 */
export function lockBreakEdit(
  prev: BreakEditState,
  text: string,
  caret: number,
  defaultStart = "12:00",
): { text: string; caret: number; state: BreakEditState } {
  const segs = readSegments(text, defaultStart);
  if (segs.some((s) => s.kind === "invalid")) return { text, caret, state: prev };

  const edits: { tok: TimeToken; value: string }[] = [];
  const nextSegs: BreakSeg[] = [];
  const locks: BreakLock[] = [];
  segs.forEach((s, i) => {
    const b = prev.segs[i];
    const lock = prev.locks[i] ?? null;
    if (s.kind !== "range" || !b || b.kind !== "range") {
      nextSegs.push(s);
      locks.push(null);
      return;
    }
    const startChanged = s.start !== b.start;
    const endChanged = s.end !== b.end;
    // Only the format changed ("13:00" → "13"): keep comparing against the finished time.
    if (!startChanged && !endChanged) {
      nextSegs.push(b);
      locks.push(lock);
      return;
    }
    if (startChanged !== endChanged) {
      const field = startChanged ? "start" : "end";
      const edited = startChanged ? s.startTok : s.endTok;
      // Still typing that time: wait for it to be finished.
      if (!COMPLETE_TIME.test(edited.text)) {
        nextSegs.push(b);
        locks.push(lock);
        return;
      }
      const was = startChanged ? b.startTok : b.endTok;
      const length = lock ? lock.length : b.end - b.start;
      const start = startChanged ? s.start : s.end - length;
      if ((lock?.field === field || COMPLETE_TIME.test(was.text)) && length > 0 && start >= 0 && start + length <= DAY_END) {
        const other = startChanged ? s.endTok : s.startTok;
        const value = fromMinutes(startChanged ? start + length : start);
        edits.push({ tok: other, value });
        nextSegs.push(startChanged ? { ...s, end: start + length, endTok: { ...other, text: value } } : { ...s, start, startTok: { ...other, text: value } });
        locks.push({ field, length });
        return;
      }
    }
    // A retyped break (or one whose length can't be kept): take it as typed.
    nextSegs.push(s);
    locks.push(null);
  });

  let out = text;
  let nextCaret = caret;
  for (const e of [...edits].sort((x, y) => y.tok.from - x.tok.from)) {
    out = out.slice(0, e.tok.from) + e.value + out.slice(e.tok.to);
    if (e.tok.to <= caret) nextCaret += e.value.length - (e.tok.to - e.tok.from);
  }
  return { text: out, caret: nextCaret, state: { segs: nextSegs, locks } };
}

/**
 * Read one day's breaks from free text: breaks separated by ";" or ",", each a range
 * ("12:00-12:30", "12-1230", "12 bis 12.30"), a start plus a length ("12:00 30m",
 * "12+45") or just a length ("30", "45m", "1h") from `defaultStart`. Empty = nothing
 * entered; "0" / "none" / "keine" = explicitly no break.
 */
export function parsePauses(text: string, defaultStart = "12:00"): ParsedPauses {
  if (NO_BREAK.test(text.trim())) return { ok: true, pauses: [], none: true };
  const pauses: PauseRange[] = [];
  for (const seg of segmentsOf(text)) {
    const p = parseSegment(seg, defaultStart);
    if (p === undefined) return { ok: false, error: `Can't read "${seg}" — try 12:00-12:30 or 12:00 30m.` };
    if (typeof p === "string") return { ok: false, error: p };
    pauses.push(p);
  }
  pauses.sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
  for (let i = 1; i < pauses.length; i++) {
    if (toMinutes(pauses[i].start) < toMinutes(pauses[i - 1].end)) return { ok: false, error: "Those breaks overlap." };
  }
  return { ok: true, pauses };
}
