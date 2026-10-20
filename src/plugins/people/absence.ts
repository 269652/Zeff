/**
 * Whether a text says someone is away until a day — "im Urlaub bis 31.10.2026", "nicht im Dienst bis …",
 * "abwesend bis …" — and that day hasn't passed yet. Pure (the People plugin's hover card reads it off the claims).
 */

const AWAY = /\b(?:urlaub|nicht im dienst|abwesend|abwesenheit)\b[^;\n]{0,60}?\bbis\s+(?:einschließlich\s+|einschl\.\s+|zum\s+|zur\s+)?(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})(?!\d)/i;

const pad = (n: number) => String(n).padStart(2, "0");

/** The day they are away until ("YYYY-MM-DD") — null when the text doesn't say, or that day is before `today` ("YYYY-MM-DD"). */
export function absenceIn(text: string, today: string): { until: string } | null {
  const m = AWAY.exec(text);
  if (!m) return null;
  const [day, month] = [Number(m[1]), Number(m[2])];
  const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  const until = `${year}-${pad(month)}-${pad(day)}`;
  return until >= today ? { until } : null;
}
