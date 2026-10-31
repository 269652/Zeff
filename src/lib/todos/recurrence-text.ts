import type { TodoRecurrence } from "@/lib/calendar/recurrence";

/**
 * The repetition a todo's text names — “danach jeweils 300 € am 15. von 15.11.2026 bis 15.09.2027”, “jeden Monat am 3.”, “jährlich”: its
 * rule, the day the repeats begin (when that is not the todo's due day, which is a one-off then) and their last day. Null where the text
 * names none (two payments are no repetition). Words, not the AI: the same text gives the same rule.
 */
const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: number, m: number, y: number) => `${y}-${pad(m)}-${pad(d)}`;
const dateAfter = (re: RegExp, text: string): string | null => {
  const m = re.exec(text);
  return m ? iso(Number(m[1]), Number(m[2]), Number(m[3])) : null;
};

/** The first day with this day of the month after `day` (YYYY-MM-DD). */
function nextDayOfMonth(after: string, dom: number): string {
  const [y, m] = after.split("-").map(Number);
  for (let i = 0; i < 14; i++) {
    const d = new Date(y, m - 1 + i, dom);
    if (d.getDate() !== dom) continue; // (a month without that day)
    const s = iso(d.getDate(), d.getMonth() + 1, d.getFullYear());
    if (s > after) return s;
  }
  return after;
}

export function recurrenceFromText(text: string, due: string | null): TodoRecurrence | null {
  const s = text.toLowerCase();
  // The day of the month (“am 15.” — not a date like “am 15.11.”).
  const dom = /\b(?:jeweils|jeden|jedes monats|monatlich)\b[^.;]*?\bam (\d{1,2})\.(?!\d)/.exec(s)?.[1] ?? /\bjeden (\d{1,2})\.(?!\d)/.exec(s)?.[1];
  let freq: TodoRecurrence["freq"] | null = null;
  if (dom || /\bjeden monat\b|\bmonatlich(?:e|en)?\b|\bjeden monatsersten\b/.test(s)) freq = "monthly";
  else if (/\bjede woche\b|\bwöchentlich(?:e|en)?\b/.test(s)) freq = "weekly";
  else if (/\bjedes jahr\b|\bjährlich(?:e|en)?\b/.test(s)) freq = "yearly";
  else if (/\bjeden tag\b|\btäglich(?:e|en)?\b/.test(s)) freq = "daily";
  if (!freq) return null;
  const rule: TodoRecurrence = { freq, interval: 1 };
  let start = dateAfter(/\bvon (\d{1,2})\.(\d{1,2})\.(\d{4})/, s) ?? dateAfter(/\bab (?:dem )?(\d{1,2})\.(\d{1,2})\.(\d{4})/, s);
  if (!start && dom && due) {
    // The due day is a one-off (pay today), the repeats begin on the next such day; due on that day itself: it starts them.
    if (Number(due.slice(8, 10)) !== Number(dom)) start = nextDayOfMonth(due, Number(dom));
  }
  if (start && (!due || start > due)) rule.start = start;
  else if (!due && !start) return null;
  const until = dateAfter(/\bbis (?:zum |zur |einschließlich |spätestens )?(\d{1,2})\.(\d{1,2})\.(\d{4})/, s);
  if (until && until > (rule.start ?? due ?? "")) rule.until = until;
  return rule;
}

/**
 * The words of the repeats (the next todo of a rate): the first payment's left out — “Erste”, “sofort”, “heute”, the day it is due by
 * (the todo's due day says when) — and the clause that names the rule (“; danach jeweils …”, “, Folgeraten …”). “Erste Rate 300 €
 * sofort überweisen; Folgeraten jeweils 300 € am 15.” → “Rate 300 € überweisen”. Words, not the AI; plain words stay as they are.
 */
export function repeatText(text: string): string {
  let s = text.replace(/\s+/g, " ").trim();
  // The rule's clause: from “; danach …”, “, anschließend …”, “; Folgeraten …”, “und die weiteren …” on.
  s = s.replace(/\s*[;,]\s*(?:und\s+)?(?:danach|anschließend|ab dann|folgeraten|folgende raten|weitere raten|die weiteren|dann jeweils|jeweils)\b.*$/i, "");
  // The first payment's words.
  s = s.replace(/^(?:die\s+)?(?:erste|1\.)\s+/i, "");
  s = s.replace(/\s+(?:sofort|umgehend|unverzüglich|heute)(?=\s)/gi, "");
  s = s.replace(/\s+bis (?:zum )?\d{1,2}\.\d{1,2}\.(?:\d{2,4})?(?=\s)/gi, "");
  s = s.replace(/\s+/g, " ").trim().replace(/[.;,]$/, "");
  return s ? s[0].toUpperCase() + s.slice(1) : text;
}
