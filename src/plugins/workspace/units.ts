/**
 * Units for formulas (the Workspace plugin): what a number is in — €, €/Monat, h, Monate, % — so a formula can say what its
 * result is in, convert what fits (€/Jahr → €/Monat, h → min, €/Monat × 12 Monate → €) and flag what doesn't (€/Monat + h).
 * A unit is its symbols with their powers ({ €: 1, Monat: -1 } is €/Monat); the symbols have spellings (Monate, months, Std …)
 * and families whose members convert (s, min, h, Tag, Woche — and apart from them Monat, Jahr: a month isn't a number of
 * days). Unknown symbols (mg, km, Stück) are units of their own. Pure, client-safe.
 */

export type Unit = Record<string, number>;

/** The symbols as they are written → their name here. */
const SPELLINGS: Record<string, string> = {
  "€": "€",
  eur: "€",
  euro: "€",
  "$": "$",
  usd: "$",
  dollar: "$",
  monat: "Monat",
  monate: "Monat",
  monaten: "Monat",
  mon: "Monat",
  mo: "Monat",
  month: "Monat",
  months: "Monat",
  jahr: "Jahr",
  jahre: "Jahr",
  jahren: "Jahr",
  j: "Jahr",
  a: "Jahr",
  year: "Jahr",
  years: "Jahr",
  yr: "Jahr",
  woche: "Woche",
  wochen: "Woche",
  wo: "Woche",
  week: "Woche",
  weeks: "Woche",
  tag: "Tag",
  tage: "Tag",
  tagen: "Tag",
  d: "Tag",
  day: "Tag",
  days: "Tag",
  h: "h",
  std: "h",
  stunde: "h",
  stunden: "h",
  hour: "h",
  hours: "h",
  min: "min",
  minute: "min",
  minuten: "min",
  minutes: "min",
  s: "s",
  sek: "s",
  sekunde: "s",
  sekunden: "s",
  "%": "%",
};

/** Symbols that convert into each other: their family and how many of the family's base one is. */
const FAMILY: Record<string, [string, number]> = {
  s: ["time", 1],
  min: ["time", 60],
  h: ["time", 3600],
  Tag: ["time", 86400],
  Woche: ["time", 604800],
  Monat: ["months", 1],
  Jahr: ["months", 12],
};

const symbol = (raw: string): string => SPELLINGS[raw.trim().toLowerCase()] ?? raw.trim();

/** A word a formula reads as a unit after a number (5 h, 12 €, 12 Monate) — the known ones only (not %: that is modulo; not "a"). */
export const isUnitWord = (w: string): boolean => w !== "%" && w.toLowerCase() !== "a" && w.toLowerCase() in SPELLINGS;

/** A unit as written ("€/Monat", "€ pro Monat", "EUR/Jahr", "h", "Monate", "km/h", "m²") — null for none. */
export function parseUnit(text: string | null | undefined): Unit | null {
  const s = (text ?? "").trim().replace(/\s+pro\s+|\s+per\s+/gi, "/");
  if (!s || s.length > 30) return null;
  const [top, ...bottom] = s.split("/");
  const u: Unit = {};
  const add = (part: string, sign: number) => {
    for (const raw of part.split(/[·*\s]+/).filter(Boolean)) {
      const m = /^(.+?)(²|³|\^(-?\d+))?$/.exec(raw)!;
      const exp = m[2] === "²" ? 2 : m[2] === "³" ? 3 : m[3] ? Number(m[3]) : 1;
      const sym = symbol(m[1]);
      if (!/^[\p{L}€$%]/u.test(sym)) return false;
      u[sym] = (u[sym] ?? 0) + sign * exp;
    }
    return true;
  };
  if (!add(top, 1) || !bottom.every((b) => add(b, -1))) return null;
  for (const k of Object.keys(u)) if (!u[k]) delete u[k];
  return Object.keys(u).length ? u : null;
}

/** A unit written out: €/Monat, €·h, 1/Monat, m². */
export function formatUnit(u: Unit | null): string {
  if (!u) return "";
  const pow = (k: string, e: number) => `${k}${e === 1 ? "" : e === 2 ? "²" : e === 3 ? "³" : `^${e}`}`;
  const top = Object.entries(u).filter(([, e]) => e > 0).map(([k, e]) => pow(k, e));
  const bottom = Object.entries(u).filter(([, e]) => e < 0).map(([k, e]) => pow(k, -e));
  if (!top.length && !bottom.length) return "";
  return `${top.join("·") || "1"}${bottom.length ? `/${bottom.join("·")}` : ""}`;
}

/** What a unit is made of (its families and other symbols, with powers) and how many base units one of it is. */
function dims(u: Unit): { dim: Record<string, number>; factor: number } {
  const dim: Record<string, number> = {};
  let factor = 1;
  for (const [k, e] of Object.entries(u)) {
    const f = FAMILY[k];
    const key = f ? `#${f[0]}` : k;
    dim[key] = (dim[key] ?? 0) + e;
    if (f) factor *= f[1] ** e;
  }
  for (const k of Object.keys(dim)) if (!dim[k]) delete dim[k];
  return { dim, factor };
}

const sameDims = (a: Record<string, number>, b: Record<string, number>) => {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
};

/** The factor that turns a value in `from` into `to` (€/Jahr → €/Monat: 1/12) — null when they don't fit. */
export function conversion(from: Unit | null, to: Unit | null): number | null {
  if (!from && !to) return 1;
  if (!from || !to) return null;
  const a = dims(from);
  const b = dims(to);
  return sameDims(a.dim, b.dim) ? a.factor / b.factor : null;
}

/** The same unit, also when written apart (€/Monat and EUR pro Monat). */
export const sameUnit = (a: Unit | null, b: Unit | null): boolean => formatUnit(a) === formatUnit(b);

/**
 * A product's or quotient's unit made simple: the symbols of a family put into one (the first written: €/Monat × Jahr → €,
 * the value × 12), and what cancels out gone. Returns the unit and the factor the value takes.
 */
export function simplify(u: Unit): { unit: Unit | null; factor: number } {
  const out: Unit = {};
  const keep: Record<string, string> = {};
  let factor = 1;
  for (const [k, e] of Object.entries(u)) {
    const f = FAMILY[k];
    if (!f) {
      out[k] = (out[k] ?? 0) + e;
      continue;
    }
    const into = (keep[f[0]] ??= k);
    out[into] = (out[into] ?? 0) + e;
    if (into !== k) factor *= (f[1] / FAMILY[into][1]) ** e;
  }
  for (const k of Object.keys(out)) if (!out[k]) delete out[k];
  return { unit: Object.keys(out).length ? out : null, factor };
}

/** Two units multiplied (sign 1) or divided (-1). */
export function combine(a: Unit | null, b: Unit | null, sign: 1 | -1): Unit {
  const out: Unit = { ...(a ?? {}) };
  for (const [k, e] of Object.entries(b ?? {})) out[k] = (out[k] ?? 0) + sign * e;
  return out;
}

/** A cell's text as a number with its unit: "12 €" → 12 €, "1.200,50 €/Monat", "5 h", "60,5" (none) — null when it is no number. */
export function numberWithUnit(text: string): { n: number; unit: Unit | null; label: string } | null {
  const m = /^(-?(?:\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?))\s*(.*)$/.exec(text.trim());
  if (!m) return null;
  const raw = m[1];
  const n = /^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(raw) ? Number(raw.replace(/\./g, "").replace(",", ".")) : Number(raw.replace(",", "."));
  if (!Number.isFinite(n)) return null;
  const label = m[2].trim();
  if (!label) return { n, unit: null, label: "" };
  const unit = parseUnit(label);
  return unit ? { n, unit, label } : null;
}
