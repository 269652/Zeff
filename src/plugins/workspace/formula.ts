/**
 * Formulas of a database's formula properties (the Workspace plugin): a small expression language —
 * numbers, "text", true/false, + - * / %, comparisons, and / or / not, a ? b : c, and functions
 * (if, prop, concat, round, dateBetween …). No eval: the text is parsed and walked here. An error is a
 * result, never a throw. Client-safe.
 *
 * And what a spreadsheet has (a cell of a table that starts with "=", sheet.ts): cells A1 ($A$1 the same), ranges A1:B3,
 * whole columns B:B and rows 3:3, a column of this row by its name [Betrag] (also [@Betrag]), another table's — shared for
 * formulas under its name — Kosten!B2, 'Meine Tabelle'!A1:A5, Kosten[Betrag] (its whole column); Kennzahlen as @Sparrate or
 * @[Frei im Monat]; Excel's spelling too: = and <> to compare, & to join, ; between arguments, SUMME / MITTELWERT / WENN …
 */

import { combine, conversion, formatUnit, isUnitWord, numberWithUnit, parseUnit, sameUnit, simplify, type Unit } from "./units";

export type FormulaValue = number | string | boolean | null | Date | EntityRef | FormulaValue[];

/**
 * What @ names in a formula: a person, a page, a todo, a ticket ([[person:12|Chris]]) — or a name nothing else had (@Freunde:
 * kind "name") for a function to resolve (a plugin's: Schulden(@Chris), Personen(@Familie)). As text it is its name.
 */
export class EntityRef {
  constructor(
    readonly kind: "person" | "page" | "todo" | "ticket" | "circle" | "name",
    readonly id: string,
    readonly label: string,
  ) {}
  toString(): string {
    return this.label;
  }
}
export type FormulaResult = { value: FormulaValue } | { error: string };
export type FormulaContext = {
  /** The value of the property named so in this row (dates as strings, multi values as arrays). */
  prop: (name: string) => unknown;
  /** The time "now" means (tests set it). */
  now?: Date;
  /** A Kennzahl's value by its name (kennzahl("Sparrate")) — none given: the server's (setMetricReader). */
  metric?: (name: string) => unknown;
  /** A Kennzahl's unit by its name ("€/Monat") — for evalWithUnits. */
  metricUnit?: (name: string) => string | null;
  /** A plugin's function by its name (none given: the server's, setFunctionReader) — a page's table asks the server through this. */
  fn?: (name: string) => FormulaFn | null;
  /** A table as cells (A1, B:B, [Betrag]): `null` this formula's own, else one shared under that name — none: no references. */
  sheet?: (name: string | null) => FormulaSheet | null;
};

/** A table as a spreadsheet sees it: columns (A = the first) by rows (1 = the first), 0-based here. */
export type FormulaSheet = {
  rows: number;
  cols: number;
  /** A cell's value (computed). */
  cell: (col: number, row: number) => unknown;
  /** A column by its name (-1: none). */
  colIndex: (name: string) => number;
  /** The row the formula stands in (its own table only). */
  row?: number;
  /** A cell's unit as written ("€", "€/Monat", "h") — null: none. */
  unit?: (col: number, row: number) => string | null;
};

/**
 * Where kennzahl() reads on the server (metrics.ts sets it): a formula anywhere — a database's column, a Kennzahl's own
 * formula — reads the account's Kennzahlen. In the browser there is none: the preview says so, the server computes it.
 */
const reader = globalThis as { __zeffMetricReader?: (name: string) => unknown; __zeffMetricUnit?: (name: string) => string | null; __zeffFormulaFn?: (name: string) => FormulaFn | null };
/** Where a Kennzahl's unit is read on the server (metrics.ts sets it). */
export const setMetricUnitReader = (fn: (name: string) => string | null): void => {
  reader.__zeffMetricUnit = fn;
};
/** (`undefined` back: there is no Kennzahl of that name — @Name is then a name for a function to resolve.) */
export const setMetricReader = (fn: (name: string) => unknown): void => {
  reader.__zeffMetricReader = fn;
};

/** A function a plugin brings (formula-point.ts): how it is worked out, what its numbers are in. */
export type FormulaFn = { call: (args: FormulaValue[]) => FormulaValue; unit?: string };
/** Where the plugins' functions are found on the server (metrics.ts sets it from formula-point.ts). */
export const setFunctionReader = (fn: (name: string) => FormulaFn | null): void => {
  reader.__zeffFormulaFn = fn;
};

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/** A token; `end` is where it stops (A1:B3 and Kosten!A1 are told by their parts touching). */
type Tok = { t: "num" | "str" | "id" | "op" | "br" | "ref" | "eof"; v: string; at: number; end: number; /** A number's unit written after it (5 h, 12 €/Monat). */ unit?: string };
/** A cell reference's end: a column and a row (0-based), either left out for a whole row / column. */
type Pt = { c: number | null; r: number | null };
type Node =
  | { k: "lit"; v: FormulaValue; unit?: string }
  | { k: "call"; name: string; args: Node[] }
  | { k: "un"; op: string; a: Node }
  | { k: "bin"; op: string; a: Node; b: Node }
  | { k: "cond"; c: Node; a: Node; b: Node }
  | { k: "ref"; sheet: string | null; a: Pt; b: Pt | null; conv?: Record<string, number> }
  | { k: "field"; sheet: string | null; name: string; conv?: Record<string, number> }
  | { k: "metric"; name: string };

const OPS = ["==", "!=", "<=", ">=", "<>", "&&", "||", "+", "-", "*", "/", "%", "<", ">", "=", "&", "!", "(", ")", ",", ";", "?", ":", "@"];

/** "A" → 0, "Z" → 25, "AA" → 26. */
export const colNumber = (letters: string): number => [...letters.toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
/** 0 → "A", 26 → "AA". */
export function colLetters(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
const CELL = /^([A-Za-z]{1,3})(\d+)$/;
/** A mention's inside: kind:ref|Label. */
const REF = /^(page|todo|ticket|person|metric|circle):([^|\]]+)(?:\|(.*))?$/;
export type RefKind = "page" | "todo" | "ticket" | "person" | "metric" | "circle";
/** A mention as text (as a page writes it): [[page:12|Titel]]. */
export const refToken = (kind: RefKind, ref: string, label: string): string => `[[${kind}:${ref}${label ? `|${label.replace(/[\]|]/g, "")}` : ""}]]`;
/** A text's mentions and the text between them, for showing them as chips. */
export function splitRefs(text: string): ({ text: string } | { kind: RefKind; ref: string; label: string })[] {
  const out: ({ text: string } | { kind: RefKind; ref: string; label: string })[] = [];
  let at = 0;
  for (const m of text.matchAll(/\[\[(page|todo|ticket|person|metric|circle):([^|\]]+)(?:\|([^\]]*))?\]\]/g)) {
    if (m.index > at) out.push({ text: text.slice(at, m.index) });
    out.push({ kind: m[1] as RefKind, ref: m[2], label: (m[3] ?? "").trim() || m[2] });
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}
const COLUMN = /^[A-Za-z]{1,3}$/;

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    // $A$1 is A1: a formula isn't copied about, so fixed and moving references are the same here.
    const fixed = c === "$" || /[A-Za-z]/.test(c) ? /^\$?([A-Za-z]{1,3})\$?(\d+)(?![\p{L}\p{N}_])/u.exec(src.slice(i)) : null;
    if (fixed && fixed[0].includes("$")) {
      out.push({ t: "id", v: `${fixed[1]}${fixed[2]}`, at: i, end: i + fixed[0].length });
      i += fixed[0].length;
      continue;
    }
    if (/\s/.test(c) || c === "$") {
      i++;
      continue;
    }
    // [[page:12|Titel]] — a mention, as a page writes one (doc.ts): what @ puts in a cell.
    if (src.startsWith("[[", i)) {
      const j = src.indexOf("]]", i);
      if (j < 0) throw new Error("Unclosed [[");
      out.push({ t: "ref", v: src.slice(i + 2, j), at: i, end: j + 2 });
      i = j + 2;
      continue;
    }
    if (c === "[") {
      const j = src.indexOf("]", i);
      if (j < 0) throw new Error("Unclosed [");
      out.push({ t: "br", v: src.slice(i + 1, j).replace(/^@/, "").trim(), at: i, end: j + 1 });
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i))!;
      // A unit after it (5 h, 12 €, 12 Monate, 3 €/Monat) — the known words only, and not a function's name (min( …).
      const u = /^\s*([€$]|\p{L}+)(?:\/(\p{L}+))?(?![\p{L}\p{N}_(])/u.exec(src.slice(i + m[0].length));
      if (u && isUnitWord(u[1]) && (!u[2] || isUnitWord(u[2]))) {
        out.push({ t: "num", v: m[0], at: i, end: i + m[0].length + u[0].length, unit: u[2] ? `${u[1]}/${u[2]}` : u[1] });
        i += m[0].length + u[0].length;
        continue;
      }
      // A % at its end is percent (45 %, @Nettoeinkommen * 45 %): what follows isn't a number to take the rest of (10 % 3 stays modulo).
      const pct = /^\s*%(?=\s*(?:$|[)+\-*/;,&<>=?:\]]))/.exec(src.slice(i + m[0].length));
      if (pct) {
        out.push({ t: "num", v: m[0], at: i, end: i + m[0].length + pct[0].length, unit: "%" });
        i += m[0].length + pct[0].length;
        continue;
      }
      out.push({ t: "num", v: m[0], at: i, end: i + m[0].length });
      i += m[0].length;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      let s = "";
      while (j < src.length && src[j] !== c) {
        if (src[j] === "\\" && j + 1 < src.length) {
          const n = src[j + 1];
          s += n === "n" ? "\n" : n === "t" ? "\t" : n;
          j += 2;
        } else s += src[j++];
      }
      if (j >= src.length) throw new Error("Unclosed text");
      out.push({ t: "str", v: s, at: i, end: j + 1 });
      i = j + 1;
      continue;
    }
    if (/[\p{L}_]/u.test(c)) {
      const m = /^[\p{L}\p{N}_]+/u.exec(src.slice(i))!;
      out.push({ t: "id", v: m[0], at: i, end: i + m[0].length });
      i += m[0].length;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) throw new Error(`Unexpected "${c}"`);
    out.push({ t: "op", v: op, at: i, end: i + op.length });
    i += op.length;
  }
  out.push({ t: "eof", v: "", at: src.length, end: src.length });
  return out;
}

class Parser {
  private i = 0;
  constructor(private toks: Tok[]) {}
  private get cur() {
    return this.toks[this.i];
  }
  private eat(v?: string): Tok {
    const t = this.cur;
    if (v !== undefined && t.v !== v) throw new Error(`Expected "${v}"${t.t === "eof" ? "" : ` but found "${t.v}"`}`);
    this.i++;
    return t;
  }
  private is(...vs: string[]) {
    return this.cur.t === "op" && vs.includes(this.cur.v);
  }
  private word(...vs: string[]) {
    return this.cur.t === "id" && vs.includes(this.cur.v.toLowerCase());
  }
  parse(): Node {
    const n = this.ternary();
    if (this.cur.t !== "eof") throw new Error(`Unexpected "${this.cur.v}"`);
    return n;
  }
  private ternary(): Node {
    const c = this.or();
    if (!this.is("?")) return c;
    this.eat("?");
    const a = this.ternary();
    this.eat(":");
    return { k: "cond", c, a, b: this.ternary() };
  }
  private or(): Node {
    let a = this.and();
    while (this.is("||") || this.word("or")) {
      this.i++;
      a = { k: "bin", op: "||", a, b: this.and() };
    }
    return a;
  }
  private and(): Node {
    let a = this.eq();
    while (this.is("&&") || this.word("and")) {
      this.i++;
      a = { k: "bin", op: "&&", a, b: this.eq() };
    }
    return a;
  }
  private eq(): Node {
    let a = this.cmp();
    while (this.is("==", "!=", "=", "<>")) {
      const op = this.eat().v;
      a = { k: "bin", op: op === "=" ? "==" : op === "<>" ? "!=" : op, a, b: this.cmp() };
    }
    return a;
  }
  private cmp(): Node {
    let a = this.cat();
    while (this.is("<", ">", "<=", ">=")) a = { k: "bin", op: this.eat().v, a, b: this.cat() };
    return a;
  }
  /** Excel's & joins texts (below + and -: =A1&" "&B1+1). */
  private cat(): Node {
    let a = this.add();
    while (this.is("&")) {
      this.eat();
      a = { k: "call", name: "concat", args: [a, this.add()] };
    }
    return a;
  }
  private add(): Node {
    let a = this.mul();
    while (this.is("+", "-")) a = { k: "bin", op: this.eat().v, a, b: this.mul() };
    return a;
  }
  private mul(): Node {
    let a = this.unary();
    while (this.is("*", "/", "%")) a = { k: "bin", op: this.eat().v, a, b: this.unary() };
    return a;
  }
  private unary(): Node {
    if (this.is("-", "!") || this.word("not")) {
      const op = this.eat().v;
      return { k: "un", op: op === "-" ? "-" : "!", a: this.unary() };
    }
    return this.primary();
  }
  /** The token after the current one touches it (no space between): A1:B3, Kosten!A1, Kosten[Betrag]. */
  private touching(k = 0): boolean {
    const a = this.toks[this.i + k];
    const b = this.toks[this.i + k + 1];
    return !!a && !!b && a.end === b.at;
  }
  /** An end of a reference at the current token: A1, B (a column), 3 (a row) — null when it is none. */
  private point(): Pt | null {
    const t = this.cur;
    if (t.t === "id") {
      const m = CELL.exec(t.v);
      if (m) return this.eat(), { c: colNumber(m[1]), r: Number(m[2]) - 1 };
      if (COLUMN.test(t.v)) return this.eat(), { c: colNumber(t.v), r: null };
    }
    if (t.t === "num" && /^\d+$/.test(t.v)) return this.eat(), { c: null, r: Number(t.v) - 1 };
    return null;
  }
  /** A reference (the sheet's name read already, or null): A1, A1:B3, B:B, 3:3, [Betrag] — on another sheet Kosten[Betrag] is its whole column. */
  private reference(sheet: string | null): Node {
    if (this.cur.t === "br") return { k: "field", sheet, name: this.eat().v };
    const at = this.cur;
    const a = this.point();
    if (!a) throw new Error(`Expected a cell (A1) after ${sheet ? `${sheet}!` : `"${at.v}"`}`);
    if (this.is(":") && this.toks[this.i - 1].end === this.cur.at && this.touching()) {
      this.eat(":");
      const b = this.point();
      if (!b || (a.c === null) !== (b.c === null) || (a.r === null) !== (b.r === null)) throw new Error("A range is A1:B3, B:B or 3:3");
      return { k: "ref", sheet, a, b };
    }
    if (a.c === null || a.r === null) throw new Error(a.c === null ? "A row is 3:3" : `A column is ${colLetters(a.c)}:${colLetters(a.c)}`);
    return { k: "ref", sheet, a, b: null };
  }
  private primary(): Node {
    const t = this.cur;
    // A row range (3:5) before a number.
    if (t.t === "num" && /^\d+$/.test(t.v) && this.toks[this.i + 1]?.t === "op" && this.toks[this.i + 1].v === ":" && this.touching() && this.touching(1) && this.toks[this.i + 2]?.t === "num") return this.reference(null);
    if (t.t === "num") return this.eat(), { k: "lit", v: Number(t.v), ...(t.unit ? { unit: t.unit } : {}) };
    // 'Meine Tabelle'!A1
    if (t.t === "str" && this.toks[this.i + 1]?.v === "!" && this.touching()) {
      this.eat();
      this.eat("!");
      return this.reference(t.v);
    }
    // 'Meine Kosten'[Betrag]
    if (t.t === "str" && this.toks[this.i + 1]?.t === "br" && this.touching()) {
      this.eat();
      return this.reference(t.v);
    }
    if (t.t === "str") return this.eat(), { k: "lit", v: t.v };
    if (t.t === "br") return this.reference(null);
    // A mention: a Kennzahl is its value, a page, person, todo or ticket its name.
    if (t.t === "ref") {
      this.eat();
      const m = REF.exec(t.v);
      if (!m) throw new Error(`Not a reference: [[${t.v}]]`);
      return m[1] === "metric" ? { k: "metric", name: m[2] } : { k: "lit", v: new EntityRef(m[1] as EntityRef["kind"], m[2], (m[3] ?? "").trim() || m[2]) };
    }
    // @Sparrate, @[Frei im Monat], @"Frei im Monat"
    if (this.is("@")) {
      this.eat("@");
      const n = this.cur;
      if (n.t !== "id" && n.t !== "str" && n.t !== "br") throw new Error("A Kennzahl after @: @Sparrate or @[Frei im Monat]");
      this.eat();
      return { k: "metric", name: n.v };
    }
    if (this.is("(")) {
      this.eat("(");
      const n = this.ternary();
      this.eat(")");
      return n;
    }
    if (t.t === "id") {
      const next = this.toks[this.i + 1];
      // Kosten!A1, Kosten[Betrag]
      if (next?.v === "!" && next.t === "op" && this.touching() && this.touching(1)) {
        this.eat();
        this.eat("!");
        return this.reference(t.v);
      }
      if (next?.t === "br" && this.touching()) {
        this.eat();
        return this.reference(t.v);
      }
      const low = t.v.toLowerCase();
      if (next?.v === "(" && next.t === "op") {
        this.eat();
        this.eat("(");
        const args: Node[] = [];
        if (!this.is(")")) {
          args.push(this.ternary());
          while (this.is(",", ";")) {
            this.eat();
            args.push(this.ternary());
          }
        }
        this.eat(")");
        return { k: "call", name: t.v, args };
      }
      if (low === "true" || low === "wahr") return this.eat(), { k: "lit", v: true };
      if (low === "false" || low === "falsch") return this.eat(), { k: "lit", v: false };
      if (CELL.test(t.v) || (COLUMN.test(t.v) && next?.v === ":" && this.touching())) return this.reference(null);
      throw new Error(`"${t.v}" is not a function — write prop("${t.v}") for a property, or a cell like A1`);
    }
    throw new Error(t.t === "eof" ? "The formula ends too soon" : `Unexpected "${t.v}"`);
  }
}

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

const isDateString = (s: string) => /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(s);

/** A property's raw value as a formula sees it: date strings become dates, a {start,end} range its start, numbers stay. */
export function toFormulaValue(v: unknown): FormulaValue {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" || typeof v === "boolean") return v;
  if (typeof v === "string") return isDateString(v) ? new Date(v.length === 10 ? `${v}T00:00:00` : v) : v;
  if (Array.isArray(v)) return v.map(toFormulaValue);
  if (typeof v === "object") {
    const o = v as { start?: unknown };
    if (typeof o.start === "string") return toFormulaValue(o.start);
  }
  return String(v);
}

const num = (v: FormulaValue): number => {
  if (typeof v === "number") return v;
  if (v instanceof EntityRef) throw new Error(v.kind === "name" ? `"${v.label}" is no Kennzahl and no number` : `"${v.label}" is a ${v.kind}, not a number — a function takes it: Schulden(@${v.label})`);
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v === null) return 0;
  if (v instanceof Date) return v.getTime();
  if (Array.isArray(v)) return v.length;
  const n = Number(v.replace(",", "."));
  if (Number.isNaN(n)) throw new Error(`"${v}" is not a number`);
  return n;
};
const str = (v: FormulaValue): string => {
  if (v === null) return "";
  if (v instanceof Date) return dateText(v);
  if (Array.isArray(v)) return v.map(str).join(", ");
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e10) / 1e10);
  return String(v);
};
const bool = (v: FormulaValue): boolean => {
  if (v === null) return false;
  if (typeof v === "string") return v !== "";
  if (Array.isArray(v)) return v.length > 0;
  if (v instanceof Date) return true;
  return !!v;
};

const pad = (n: number, w = 2) => String(n).padStart(w, "0");
function dateText(d: Date): string {
  const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return d.getHours() || d.getMinutes() ? `${day} ${pad(d.getHours())}:${pad(d.getMinutes())}` : day;
}
const asDate = (v: FormulaValue): Date => {
  if (v instanceof Date) return v;
  if (typeof v === "string" && isDateString(v)) return new Date(v.length === 10 ? `${v}T00:00:00` : v);
  throw new Error("Not a date");
};

const UNIT_MS: Record<string, number> = { seconds: 1e3, minutes: 6e4, hours: 36e5, days: 864e5, weeks: 6048e5 };
const unitOf = (v: FormulaValue): string => {
  const u = str(v).toLowerCase();
  const s = u.endsWith("s") ? u : `${u}s`;
  if (s in UNIT_MS || s === "months" || s === "years") return s;
  throw new Error(`Unknown unit "${u}" (days, weeks, months, years, hours, minutes)`);
};
function addUnits(d: Date, n: number, unit: string): Date {
  const r = new Date(d);
  if (unit === "months") r.setMonth(r.getMonth() + n);
  else if (unit === "years") r.setFullYear(r.getFullYear() + n);
  else if (unit === "days" || unit === "weeks") r.setDate(r.getDate() + n * (unit === "weeks" ? 7 : 1));
  else r.setTime(r.getTime() + n * UNIT_MS[unit]);
  return r;
}

function equal(a: FormulaValue, b: FormulaValue): boolean {
  if (a instanceof EntityRef || b instanceof EntityRef) return str(a).toLowerCase() === str(b).toLowerCase();
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (Array.isArray(a) || Array.isArray(b)) return str(a) === str(b);
  return a === b;
}
function compare(a: FormulaValue, b: FormulaValue): number {
  if (a instanceof Date || b instanceof Date) return asDate(a).getTime() - asDate(b).getTime();
  if (typeof a === "string" && typeof b === "string") return a.localeCompare(b);
  return num(a) - num(b);
}

type Fn = (args: FormulaValue[], ctx: FormulaContext) => FormulaValue;
const need = (name: string, args: FormulaValue[], min: number, max = min) => {
  if (args.length < min || args.length > max) throw new Error(`${name}() takes ${min === max ? min : `${min}–${max}`} argument${max === 1 ? "" : "s"}`);
};
const flat = (args: FormulaValue[]): FormulaValue[] => args.flatMap((a) => (Array.isArray(a) ? flat(a) : [a]));
/** The numbers of the arguments, lists and ranges spread — empty cells and texts left out (as Excel's SUM, AVERAGE, MIN do). */
const nums = (args: FormulaValue[]) => flat(args).filter((v) => v !== null && v !== "" && !(typeof v === "string" && Number.isNaN(Number(v.replace(",", "."))))).map(num);

const FUNCTIONS: Record<string, Fn> = {
  concat: (a) => a.map(str).join(""),
  join: (a) => (need("join", a, 1, 2), (Array.isArray(a[0]) ? a[0] : [a[0]]).map(str).join(a[1] === undefined ? ", " : str(a[1]))),
  length: (a) => (need("length", a, 1), Array.isArray(a[0]) ? a[0].length : str(a[0]).length),
  lower: (a) => (need("lower", a, 1), str(a[0]).toLowerCase()),
  upper: (a) => (need("upper", a, 1), str(a[0]).toUpperCase()),
  trim: (a) => (need("trim", a, 1), str(a[0]).trim()),
  replace: (a) => (need("replace", a, 3), str(a[0]).split(str(a[1])).join(str(a[2]))),
  contains: (a) => (need("contains", a, 2), Array.isArray(a[0]) ? a[0].some((x) => equal(x, a[1]) || str(x) === str(a[1])) : str(a[0]).toLowerCase().includes(str(a[1]).toLowerCase())),
  slice: (a) => (need("slice", a, 2, 3), str(a[0]).slice(num(a[1]), a[2] === undefined ? undefined : num(a[2]))),
  empty: (a) => (need("empty", a, 1), a[0] === null || a[0] === "" || (Array.isArray(a[0]) && !a[0].length)),
  round: (a) => (need("round", a, 1, 2), Math.round(num(a[0]) * 10 ** (a[1] === undefined ? 0 : num(a[1]))) / 10 ** (a[1] === undefined ? 0 : num(a[1]))),
  floor: (a) => (need("floor", a, 1), Math.floor(num(a[0]))),
  ceil: (a) => (need("ceil", a, 1), Math.ceil(num(a[0]))),
  abs: (a) => (need("abs", a, 1), Math.abs(num(a[0]))),
  sqrt: (a) => (need("sqrt", a, 1), Math.sqrt(num(a[0]))),
  pow: (a) => (need("pow", a, 2), num(a[0]) ** num(a[1])),
  min: (a) => (need("min", a, 1, 99), Math.min(...nums(a))),
  max: (a) => (need("max", a, 1, 99), Math.max(...nums(a))),
  sum: (a) => (need("sum", a, 1, 99), nums(a).reduce((x, y) => x + y, 0)),
  mean: (a) => (need("mean", a, 1, 99), nums(a).reduce((x, y) => x + y, 0) / Math.max(1, nums(a).length)),
  product: (a) => (need("product", a, 1, 99), nums(a).reduce((x, y) => x * y, 1)),
  /** The numbers among the values (Excel's COUNT). */
  count: (a) => flat(a).filter((v) => typeof v === "number" || (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v.replace(",", "."))))).length,
  /** The values that aren't empty (COUNTA). */
  counta: (a) => flat(a).filter((v) => v !== null && v !== "").length,
  and: (a) => (need("and", a, 1, 99), flat(a).every(bool)),
  or: (a) => (need("or", a, 1, 99), flat(a).some(bool)),
  toNumber: (a) => (need("toNumber", a, 1), num(a[0])),
  text: (a) => (need("text", a, 1), str(a[0])),
  now: (a, c) => (need("now", a, 0), c.now ?? new Date()),
  today: (a, c) => {
    need("today", a, 0);
    const d = new Date(c.now ?? new Date());
    d.setHours(0, 0, 0, 0);
    return d;
  },
  year: (a) => (need("year", a, 1), asDate(a[0]).getFullYear()),
  month: (a) => (need("month", a, 1), asDate(a[0]).getMonth() + 1),
  day: (a) => (need("day", a, 1), asDate(a[0]).getDate()),
  weekday: (a) => (need("weekday", a, 1), (asDate(a[0]).getDay() + 6) % 7 + 1),
  dateAdd: (a) => (need("dateAdd", a, 3), addUnits(asDate(a[0]), num(a[1]), unitOf(a[2]))),
  dateSubtract: (a) => (need("dateSubtract", a, 3), addUnits(asDate(a[0]), -num(a[1]), unitOf(a[2]))),
  dateBetween: (a) => {
    need("dateBetween", a, 3);
    const x = asDate(a[0]);
    const y = asDate(a[1]);
    const unit = unitOf(a[2]);
    if (unit === "months") return (x.getFullYear() - y.getFullYear()) * 12 + x.getMonth() - y.getMonth();
    if (unit === "years") return x.getFullYear() - y.getFullYear();
    return Math.trunc((x.getTime() - y.getTime()) / UNIT_MS[unit]);
  },
  formatDate: (a) => {
    need("formatDate", a, 1, 2);
    const d = asDate(a[0]);
    const f = a[1] === undefined ? "YYYY-MM-DD" : str(a[1]);
    return f.replace(/YYYY|YY|MM|DD|HH|mm/g, (m) => ({ YYYY: String(d.getFullYear()), YY: String(d.getFullYear()).slice(2), MM: pad(d.getMonth() + 1), DD: pad(d.getDate()), HH: pad(d.getHours()), mm: pad(d.getMinutes()) })[m]!);
  },
};

/** Excel's names (German and English) for the functions — =SUMME(A1:A3), =MITTELWERT(B:B), =WENN(A1>0; "ja"; "nein"). */
const ALIASES: Record<string, string> = {
  summe: "sum",
  average: "mean",
  mittelwert: "mean",
  avg: "mean",
  anzahl: "count",
  anzahl2: "counta",
  produkt: "product",
  runden: "round",
  aufrunden: "ceil",
  abrunden: "floor",
  wurzel: "sqrt",
  potenz: "pow",
  wenn: "if",
  wennfehler: "iferror",
  und: "and",
  oder: "or",
  heute: "today",
  jetzt: "now",
  verketten: "concat",
  länge: "length",
  laenge: "length",
  klein: "lower",
  gross: "upper",
  groß: "upper",
  glätten: "trim",
  jahr: "year",
  monat: "month",
  tag: "day",
  wochentag: "weekday",
};
const canonical = (name: string) => ALIASES[name.toLowerCase()] ?? name;

/** A cell's value as a formula takes it. */
const cellValue = (v: unknown): FormulaValue => {
  if (typeof v !== "string" || !v.trim()) return toFormulaValue(v);
  const n = numberWithUnit(v);
  return n ? n.n : toFormulaValue(v);
};

/** A cell of a range in the range's unit (units.ts: 30 min beside 2 h). */
const convert = (v: FormulaValue, f: number | undefined): FormulaValue => (f !== undefined && f !== 1 && typeof v === "number" ? v * f : v);

function sheetOf(ctx: FormulaContext, name: string | null): FormulaSheet {
  const s = ctx.sheet?.(name);
  if (s) return s;
  if (!ctx.sheet) throw new Error("Cell references (A1, [Column]) work in a table's cells");
  throw new Error(`No table "${name}" shared for formulas (its ⋯ menu: Share for formulas)`);
}

function run(n: Node, ctx: FormulaContext): FormulaValue {
  switch (n.k) {
    case "lit":
      return n.v;
    case "metric": {
      const read = ctx.metric ?? reader.__zeffMetricReader;
      if (!read) throw new Error("Kennzahlen are read on the server — saved, the value shows");
      const v = read(n.name);
      // No Kennzahl of that name: a name, for a function to resolve (Schulden(@Chris), Personen(@Freunde)).
      return v === undefined ? new EntityRef("name", n.name, n.name) : toFormulaValue(v);
    }
    case "field": {
      const s = sheetOf(ctx, n.sheet);
      const c = s.colIndex(n.name);
      if (c < 0) throw new Error(`No column "${n.name}"${n.sheet ? ` in ${n.sheet}` : ""}`);
      // [Betrag] is this row's; another table's Kosten[Betrag] is its whole column.
      if (n.sheet === null && s.row !== undefined) return cellValue(s.cell(c, s.row));
      return Array.from({ length: s.rows }, (_, r) => convert(cellValue(s.cell(c, r)), n.conv?.[`${r}:${c}`]));
    }
    case "ref": {
      const s = sheetOf(ctx, n.sheet);
      if (!n.b) {
        if (n.a.c! >= s.cols || n.a.r! >= s.rows) return null;
        return cellValue(s.cell(n.a.c!, n.a.r!));
      }
      const [c1, c2] = n.a.c === null ? [0, s.cols - 1] : [Math.min(n.a.c, n.b.c!), Math.min(s.cols - 1, Math.max(n.a.c, n.b.c!))];
      const [r1, r2] = n.a.r === null ? [0, s.rows - 1] : [Math.min(n.a.r, n.b.r!), Math.min(s.rows - 1, Math.max(n.a.r, n.b.r!))];
      const out: FormulaValue[] = [];
      for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) out.push(convert(cellValue(s.cell(c, r)), n.conv?.[`${r}:${c}`]));
      return out;
    }
    case "un": {
      const v = run(n.a, ctx);
      return n.op === "-" ? -num(v) : !bool(v);
    }
    case "cond":
      return bool(run(n.c, ctx)) ? run(n.a, ctx) : run(n.b, ctx);
    case "bin": {
      if (n.op === "&&") return bool(run(n.a, ctx)) && bool(run(n.b, ctx));
      if (n.op === "||") return bool(run(n.a, ctx)) || bool(run(n.b, ctx));
      const a = run(n.a, ctx);
      const b = run(n.b, ctx);
      switch (n.op) {
        case "+":
          if (typeof a === "string" || typeof b === "string") return str(a) + str(b);
          if (a instanceof Date) return new Date(a.getTime() + num(b));
          return num(a) + num(b);
        case "-":
          if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
          return num(a) - num(b);
        case "*":
          return num(a) * num(b);
        case "/": {
          const d = num(b);
          if (d === 0) throw new Error("Division by zero");
          return num(a) / d;
        }
        case "%": {
          const d = num(b);
          if (d === 0) throw new Error("Division by zero");
          return num(a) % d;
        }
        case "==":
          return equal(a, b);
        case "!=":
          return !equal(a, b);
        case "<":
          return compare(a, b) < 0;
        case ">":
          return compare(a, b) > 0;
        case "<=":
          return compare(a, b) <= 0;
        default:
          return compare(a, b) >= 0;
      }
    }
    case "call": {
      const name = canonical(n.name).toLowerCase() === "if" ? "if" : canonical(n.name).toLowerCase() === "iferror" ? "iferror" : canonical(n.name);
      // A value, or — when it fails (a division by zero, a cell that has none) — the other.
      if (name === "iferror") {
        if (n.args.length !== 2) throw new Error("iferror() takes 2 arguments");
        try {
          return run(n.args[0], ctx);
        } catch {
          return run(n.args[1], ctx);
        }
      }
      // Lazily: only the branch taken (so a division by zero in the other isn't an error).
      if (name === "if") {
        if (n.args.length < 2 || n.args.length > 3) throw new Error("if() takes 2–3 arguments");
        return bool(run(n.args[0], ctx)) ? run(n.args[1], ctx) : n.args[2] ? run(n.args[2], ctx) : null;
      }
      if (name === "ifs") {
        for (let i = 0; i + 1 < n.args.length; i += 2) if (bool(run(n.args[i], ctx))) return run(n.args[i + 1], ctx);
        return n.args.length % 2 ? run(n.args[n.args.length - 1], ctx) : null;
      }
      if (name === "kennzahl" || name === "metric") {
        if (n.args.length !== 1) throw new Error('kennzahl() takes the Kennzahl\'s name: kennzahl("Sparrate")');
        const read = ctx.metric ?? reader.__zeffMetricReader;
        if (!read) throw new Error("Kennzahlen are read on the server — saved, the value shows");
        return toFormulaValue(read(str(run(n.args[0], ctx))));
      }
      if (name === "prop") {
        if (n.args.length !== 1) throw new Error('prop() takes the property\'s name: prop("Name")');
        return toFormulaValue(ctx.prop(str(run(n.args[0], ctx))));
      }
      const key = Object.keys(FUNCTIONS).find((k) => k.toLowerCase() === name.toLowerCase());
      if (!key) {
        // A plugin's (Schulden, Personen …): on the server from the plugins, in the browser asked of the server.
        const ext = (ctx.fn ?? reader.__zeffFormulaFn)?.(n.name);
        if (!ext) throw new Error(`Unknown function "${n.name}"`);
        return ext.call(n.args.map((a) => run(a, ctx)));
      }
      return FUNCTIONS[key](
        n.args.map((a) => run(a, ctx)),
        ctx,
      );
    }
  }
}

/** The function names, for the editor's help. */
export const FORMULA_FUNCTIONS = ["if", "ifs", "iferror", "prop", "kennzahl", ...Object.keys(FUNCTIONS)].sort();

/** How each function is called — the editor shows it beside the name. */
export const FORMULA_SIGNATURES: Record<string, string> = {
  prop: 'prop("Name")',
  kennzahl: 'kennzahl("Sparrate")',
  if: "if(condition, then, else)",
  ifs: "ifs(condition, value, …, else)",
  concat: "concat(text, …)",
  join: 'join(list, ", "?)',
  length: "length(text or list)",
  lower: "lower(text)",
  upper: "upper(text)",
  trim: "trim(text)",
  replace: "replace(text, find, with)",
  contains: "contains(text or list, value)",
  slice: "slice(text, start, end?)",
  empty: "empty(value)",
  round: "round(number, digits?)",
  floor: "floor(number)",
  ceil: "ceil(number)",
  abs: "abs(number)",
  sqrt: "sqrt(number)",
  pow: "pow(number, power)",
  min: "min(number, …)",
  max: "max(number, …)",
  sum: "sum(number, …)",
  mean: "mean(number, …)",
  product: "product(number, …)",
  count: "count(A1:A9) — the numbers",
  counta: "counta(A1:A9) — the values not empty",
  and: "and(condition, …)",
  or: "or(condition, …)",
  iferror: "iferror(value, else)",
  toNumber: "toNumber(value)",
  text: "text(value)",
  now: "now()",
  today: "today()",
  year: "year(date)",
  month: "month(date)",
  day: "day(date)",
  weekday: "weekday(date)",
  dateAdd: 'dateAdd(date, n, "days")',
  dateSubtract: 'dateSubtract(date, n, "days")',
  dateBetween: 'dateBetween(date, date, "days")',
  formatDate: 'formatDate(date, "DD.MM.YYYY"?)',
};

/** Syntax check only: null when the formula parses, else what is wrong. */
export function checkFormula(src: string): string | null {
  try {
    if (!src.trim()) return "The formula is empty";
    new Parser(tokenize(src)).parse();
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** Evaluate a formula for one row. */
export function evalFormula(src: string, ctx: FormulaContext): FormulaResult {
  try {
    if (!src.trim()) return { value: null };
    const ast = new Parser(tokenize(src)).parse();
    return { value: run(ast, ctx) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------------------
// Units: what a result is in (units.ts)
// ---------------------------------------------------------------------------

/** A result with its unit: "€/Monat" ("" none) and what didn't fit (€/Monat + h …). */
export type UnitResult = { value: FormulaValue; unit: string; warnings: string[] } | { error: string };

/**
 * A formula worked out with its units: the units of its Kennzahlen and cells go through it — a number without one takes the
 * other side's (=@Tilgungsrate + 3 is in €/Monat), what fits is converted (€/Jahr + €/Monat, €/Monat × 12 Monate → €, h and
 * min, a % of an amount is a share of it), what doesn't is said (a warning, the value is still worked out).
 */
export function evalWithUnits(src: string, ctx: FormulaContext): UnitResult {
  try {
    if (!src.trim()) return { value: null, unit: "", warnings: [] };
    const ast = new Parser(tokenize(src)).parse();
    const u = inferUnits(ast, ctx);
    const value = run(u.node, ctx);
    const numeric = typeof value === "number" || (Array.isArray(value) && value.every((x) => typeof x === "number" || x === null));
    return { value, unit: numeric ? u.label : "", warnings: u.warnings };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

type Inferred = { n: Node; u: Unit | null };

function inferUnits(root: Node, ctx: FormulaContext): { node: Node; label: string; warnings: string[] } {
  const warnings: string[] = [];
  // The units as written where they came from (Monate, € pro Monat): a result in one of them is said that way.
  const labels = new Map<string, string>();
  const name = (u: Unit | null) => (u ? (labels.get(formatUnit(u)) ?? formatUnit(u)) : "");
  const leaf = (text: string | null | undefined): Unit | null => {
    const u = parseUnit(text);
    if (u && text && !labels.has(formatUnit(u))) labels.set(formatUnit(u), text.trim());
    return u;
  };
  const warn = (w: string) => warnings.includes(w) || warnings.push(w);
  const scale = (n: Node, f: number): Node => (f === 1 ? n : { k: "bin", op: "*", a: n, b: { k: "lit", v: f } });
  /** Two sides that are added, compared or chosen between: the second converted into the first's unit; none takes the other's. */
  const merge = (a: Inferred, b: Inferred): { a: Node; b: Node; u: Unit | null } => {
    if (!a.u || !b.u) return { a: a.n, b: b.n, u: a.u ?? b.u };
    const f = conversion(b.u, a.u);
    if (f === null) {
      warn(`${name(a.u)} and ${name(b.u)} don't go together`);
      return { a: a.n, b: b.n, u: a.u };
    }
    return { a: a.n, b: scale(b.n, f), u: a.u };
  };
  const mergeAll = (xs: Inferred[]): { ns: Node[]; u: Unit | null } => {
    const first = xs.find((x) => x.u);
    if (!first) return { ns: xs.map((x) => x.n), u: null };
    return { ns: xs.map((x) => (x === first ? x.n : merge(first, x).b)), u: first.u };
  };
  /**
   * The unit of many cells (a range, a column — each by its key "row:col"): the first one's; the others converted into it
   * (their factors), a warning for one that doesn't fit.
   */
  const cellsUnit = (cells: [string, string | null | undefined][]): { u: Unit | null; conv?: Record<string, number> } => {
    const us = cells.flatMap(([k, t]) => {
      const u = leaf(t);
      return u ? [[k, u] as const] : [];
    });
    if (!us.length) return { u: null };
    const first = us[0][1];
    const conv: Record<string, number> = {};
    for (const [k, u] of us) {
      if (sameUnit(u, first)) continue;
      const f = conversion(u, first);
      if (f === null) warn(`The range mixes ${name(first)} and ${name(u)}`);
      else conv[k] = f;
    }
    return { u: first, ...(Object.keys(conv).length ? { conv } : {}) };
  };
  const sheet = (n: string | null): FormulaSheet | null => {
    try {
      return ctx.sheet?.(n) ?? null;
    } catch {
      return null;
    }
  };
  const walk = (n: Node): Inferred => {
    switch (n.k) {
      case "lit":
        return { n, u: n.unit ? leaf(n.unit) : null };
      case "metric":
        return { n, u: leaf((ctx.metricUnit ?? reader.__zeffMetricUnit)?.(n.name)) };
      case "ref": {
        const s = sheet(n.sheet);
        if (!s?.unit) return { n, u: null };
        if (!n.b) return { n, u: leaf(s.unit(n.a.c!, n.a.r!)) };
        const [c1, c2] = n.a.c === null ? [0, s.cols - 1] : [Math.min(n.a.c, n.b.c!), Math.max(n.a.c, n.b.c!)];
        const [r1, r2] = n.a.r === null ? [0, s.rows - 1] : [Math.min(n.a.r, n.b.r!), Math.max(n.a.r, n.b.r!)];
        const cells: [string, string | null][] = [];
        for (let r = r1; r <= Math.min(r2, s.rows - 1, r1 + 2000); r++) for (let c = c1; c <= Math.min(c2, s.cols - 1); c++) cells.push([`${r}:${c}`, s.unit(c, r)]);
        const cu = cellsUnit(cells);
        return { n: cu.conv ? { ...n, conv: cu.conv } : n, u: cu.u };
      }
      case "field": {
        const s = sheet(n.sheet);
        const c = s?.colIndex(n.name) ?? -1;
        if (!s?.unit || c < 0) return { n, u: null };
        if (n.sheet === null && s.row !== undefined) return { n, u: leaf(s.unit(c, s.row)) };
        const cu = cellsUnit(Array.from({ length: Math.min(s.rows, 2000) }, (_, r) => [`${r}:${c}`, s.unit!(c, r)] as [string, string | null]));
        return { n: cu.conv ? { ...n, conv: cu.conv } : n, u: cu.u };
      }
      case "un": {
        const a = walk(n.a);
        return { n: { ...n, a: a.n }, u: n.op === "-" ? a.u : null };
      }
      case "cond": {
        const c = walk(n.c);
        const m = merge(walk(n.a), walk(n.b));
        return { n: { k: "cond", c: c.n, a: m.a, b: m.b }, u: m.u };
      }
      case "bin": {
        const a = walk(n.a);
        const b = walk(n.b);
        if (n.op === "&&" || n.op === "||") return { n: { ...n, a: a.n, b: b.n }, u: null };
        if (["+", "-", "==", "!=", "<", ">", "<=", ">="].includes(n.op)) {
          const m = merge(a, b);
          return { n: { ...n, a: m.a, b: m.b }, u: n.op === "+" || n.op === "-" ? m.u : null };
        }
        if (n.op === "%") return { n: { ...n, a: a.n, b: b.n }, u: a.u };
        // × and ÷: the powers add up; a % of an amount (Sparquote × Einkommen) is a share of it.
        let [an, bn, au, bu] = [a.n, b.n, a.u, b.u];
        const pct = (u: Unit | null) => !!u && u["%"] === 1 && Object.keys(u).length === 1;
        if (pct(au) && bu && !pct(bu)) [an, au] = [scale(an, 0.01), null];
        if (pct(bu) && au && !pct(au)) [bn, bu] = [scale(bn, 0.01), null];
        const s = simplify(combine(au, bu, n.op === "*" ? 1 : -1));
        return { n: scale({ ...n, a: an, b: bn }, s.factor), u: s.unit };
      }
      case "call": {
        const fn = canonical(n.name).toLowerCase();
        const args = n.args.map(walk);
        const call = (ns: Node[]): Node => ({ ...n, args: ns });
        if (fn === "if") {
          const m = merge(args[1] ?? { n: { k: "lit", v: null }, u: null }, args[2] ?? { n: { k: "lit", v: null }, u: null });
          return { n: call([args[0]?.n, m.a, ...(args[2] ? [m.b] : [])].filter(Boolean) as Node[]), u: m.u };
        }
        if (fn === "iferror" && args.length === 2) {
          const m = merge(args[0], args[1]);
          return { n: call([m.a, m.b]), u: m.u };
        }
        if (fn === "ifs") {
          const values = args.filter((_, i) => i % 2 === 1 || (args.length % 2 === 1 && i === args.length - 1));
          const m = mergeAll(values);
          let k = 0;
          return { n: call(args.map((x) => (values.includes(x) ? m.ns[k++] : x.n))), u: m.u };
        }
        if (["sum", "mean", "min", "max"].includes(fn)) {
          const m = mergeAll(args);
          return { n: call(m.ns), u: m.u };
        }
        if (["round", "floor", "ceil", "abs"].includes(fn)) return { n: call(args.map((x) => x.n)), u: args[0]?.u ?? null };
        if (fn === "product") {
          const s = simplify(args.reduce<Unit>((u, x) => combine(u, x.u, 1), {}));
          return { n: scale(call(args.map((x) => x.n)), s.factor), u: s.unit };
        }
        if (fn === "pow" && args[0]?.u && n.args[1]?.k === "lit" && typeof n.args[1].v === "number") {
          const e = n.args[1].v;
          return { n: call(args.map((x) => x.n)), u: Object.fromEntries(Object.entries(args[0].u).map(([k, v]) => [k, v * e])) };
        }
        if ((fn === "kennzahl" || fn === "metric") && n.args[0]?.k === "lit") return { n: call(args.map((x) => x.n)), u: leaf((ctx.metricUnit ?? reader.__zeffMetricUnit)?.(String(n.args[0].v))) };
        // A plugin's function: its unit (Schulden: €).
        if (!Object.keys(FUNCTIONS).some((k) => k.toLowerCase() === fn)) {
          let ext: FormulaFn | null = null;
          try {
            ext = (ctx.fn ?? reader.__zeffFormulaFn)?.(n.name) ?? null;
          } catch {
            ext = null;
          }
          return { n: call(args.map((x) => x.n)), u: leaf(ext?.unit) };
        }
        return { n: call(args.map((x) => x.n)), u: null };
      }
    }
  };
  const out = walk(root);
  return { node: out.n, label: name(out.u), warnings };
}

/** A formula result as it is stored and shown: dates as ISO text, the rest as it is. */
export function formulaToStored(v: FormulaValue): string | number | boolean | null | (string | number | boolean | null)[] {
  if (v instanceof EntityRef) return v.label;
  if (v instanceof Date) return v.getHours() || v.getMinutes() ? `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}T${pad(v.getHours())}:${pad(v.getMinutes())}` : `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  if (Array.isArray(v)) return v.map((x) => formulaToStored(x) as string | number | boolean | null);
  return v;
}

/** The formula for "days since" a date property (the rollup wizard adds it beside a rollup of the latest date): counts up as the date goes by. */
export const daysSinceFormula = (prop: string): string => `dateBetween(today(), prop(${JSON.stringify(prop)}), "days")`;

// ---------------------------------------------------------------------------
// The editor's help: references and completions
// ---------------------------------------------------------------------------

/** The properties a formula names — each prop("…") with where it stands (a text that doesn't parse: those that are whole). */
export function formulaRefs(src: string): { name: string; from: number; to: number }[] {
  const out: { name: string; from: number; to: number }[] = [];
  for (const m of src.matchAll(/\bprop\s*\(\s*(["'])((?:(?!\1).)*)\1\s*\)/g)) out.push({ name: m[2], from: m.index, to: m.index + m[0].length });
  return out;
}

export type FormulaCompletion = { kind: "function" | "property"; label: string; insert: string };

/**
 * What can be put in at the caret: inside prop("… the property names (the rest of the name and the closing ") put in);
 * else, a word begun, the functions it starts and the properties it starts (as prop("…")). `from`–`to` is what is replaced.
 */
export function formulaCompletions(src: string, caret: number, props: string[], opts: { all?: boolean } = {}): { from: number; to: number; items: FormulaCompletion[] } {
  const before = src.slice(0, caret);
  const ranked = (names: string[], q: string) => {
    const w = q.toLowerCase();
    return [...names.filter((n) => n.toLowerCase().startsWith(w)), ...names.filter((n) => !n.toLowerCase().startsWith(w) && n.toLowerCase().includes(w))];
  };
  const inProp = /\bprop\s*\(\s*(["'])([^"']*)$/.exec(before);
  if (inProp) {
    const q = inProp[2];
    return { from: caret - q.length, to: caret, items: ranked(props, q).map((n) => ({ kind: "property", label: n, insert: `${n}${inProp[1]})` })) };
  }
  const word = /(?:^|[^\w."'])([A-Za-z_]\w*)$/.exec(before);
  // Nothing begun: nothing — unless the whole list is asked for.
  if (!word && !opts.all) return { from: caret, to: caret, items: [] };
  const q = word?.[1] ?? "";
  const w = q.toLowerCase();
  // prop first: the way to a property (its name offered next).
  const fns = ["prop", ...FORMULA_FUNCTIONS.filter((f) => f !== "prop")].filter((f) => f.toLowerCase().startsWith(w)).map((f) => ({ kind: "function" as const, label: f, insert: f === "prop" ? 'prop("' : `${f}(` }));
  const ps = props.filter((n) => n.toLowerCase().startsWith(w)).map((n) => ({ kind: "property" as const, label: n, insert: `prop(${JSON.stringify(n)})` }));
  return { from: caret - q.length, to: caret, items: [...fns, ...ps] };
}

// ---------------------------------------------------------------------------
// A plugin's function asked of the server (a page's table works out in the browser)
// ---------------------------------------------------------------------------

/** A value as it travels (JSON): a mention {e: [kind, id, label]}, a date {d: ISO}, lists as lists. */
export type WireValue = number | string | boolean | null | { e: [string, string, string] } | { d: string } | WireValue[];

export function toWire(v: FormulaValue): WireValue {
  if (v instanceof EntityRef) return { e: [v.kind, v.id, v.label] };
  if (v instanceof Date) return { d: v.toISOString() };
  if (Array.isArray(v)) return v.map(toWire);
  return v;
}

export function fromWire(v: WireValue): FormulaValue {
  if (Array.isArray(v)) return v.map(fromWire);
  if (v && typeof v === "object") return "e" in v ? new EntityRef(v.e[0] as EntityRef["kind"], v.e[1], v.e[2]) : new Date(v.d);
  return v;
}

/** A call's key: its name and arguments (what the server is asked once and the page keeps). */
export const callKey = (name: string, args: FormulaValue[]): string => `${name.toLowerCase()}(${JSON.stringify(args.map(toWire))})`;
