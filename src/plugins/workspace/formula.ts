/**
 * Formulas of a database's formula properties (the Workspace plugin): a small expression language —
 * numbers, "text", true/false, + - * / %, comparisons, and / or / not, a ? b : c, and functions
 * (if, prop, concat, round, dateBetween …). No eval: the text is parsed and walked here. An error is a
 * result, never a throw. Client-safe.
 */

export type FormulaValue = number | string | boolean | null | Date | FormulaValue[];
export type FormulaResult = { value: FormulaValue } | { error: string };
export type FormulaContext = {
  /** The value of the property named so in this row (dates as strings, multi values as arrays). */
  prop: (name: string) => unknown;
  /** The time "now" means (tests set it). */
  now?: Date;
};

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

type Tok = { t: "num" | "str" | "id" | "op" | "eof"; v: string; at: number };
type Node =
  | { k: "lit"; v: FormulaValue }
  | { k: "call"; name: string; args: Node[] }
  | { k: "un"; op: string; a: Node }
  | { k: "bin"; op: string; a: Node; b: Node }
  | { k: "cond"; c: Node; a: Node; b: Node };

const OPS = ["==", "!=", "<=", ">=", "&&", "||", "+", "-", "*", "/", "%", "<", ">", "!", "(", ")", ",", "?", ":"];

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i))!;
      out.push({ t: "num", v: m[0], at: i });
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
      out.push({ t: "str", v: s, at: i });
      i = j + 1;
      continue;
    }
    if (/[\p{L}_]/u.test(c)) {
      const m = /^[\p{L}\p{N}_]+/u.exec(src.slice(i))!;
      out.push({ t: "id", v: m[0], at: i });
      i += m[0].length;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) throw new Error(`Unexpected "${c}"`);
    out.push({ t: "op", v: op, at: i });
    i += op.length;
  }
  out.push({ t: "eof", v: "", at: src.length });
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
    while (this.is("==", "!=")) a = { k: "bin", op: this.eat().v, a, b: this.cmp() };
    return a;
  }
  private cmp(): Node {
    let a = this.add();
    while (this.is("<", ">", "<=", ">=")) a = { k: "bin", op: this.eat().v, a, b: this.add() };
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
  private primary(): Node {
    const t = this.cur;
    if (t.t === "num") return this.eat(), { k: "lit", v: Number(t.v) };
    if (t.t === "str") return this.eat(), { k: "lit", v: t.v };
    if (this.is("(")) {
      this.eat("(");
      const n = this.ternary();
      this.eat(")");
      return n;
    }
    if (t.t === "id") {
      this.eat();
      const low = t.v.toLowerCase();
      if (low === "true") return { k: "lit", v: true };
      if (low === "false") return { k: "lit", v: false };
      if (this.is("(")) {
        this.eat("(");
        const args: Node[] = [];
        if (!this.is(")")) {
          args.push(this.ternary());
          while (this.is(",")) {
            this.eat(",");
            args.push(this.ternary());
          }
        }
        this.eat(")");
        return { k: "call", name: t.v, args };
      }
      throw new Error(`"${t.v}" is not a function — write prop("${t.v}") for a property`);
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
const nums = (args: FormulaValue[]) => args.flatMap((a) => (Array.isArray(a) ? a : [a])).map(num);

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

function run(n: Node, ctx: FormulaContext): FormulaValue {
  switch (n.k) {
    case "lit":
      return n.v;
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
      const name = n.name;
      // Lazily: only the branch taken (so a division by zero in the other isn't an error).
      if (name === "if") {
        if (n.args.length < 2 || n.args.length > 3) throw new Error("if() takes 2–3 arguments");
        return bool(run(n.args[0], ctx)) ? run(n.args[1], ctx) : n.args[2] ? run(n.args[2], ctx) : null;
      }
      if (name === "ifs") {
        for (let i = 0; i + 1 < n.args.length; i += 2) if (bool(run(n.args[i], ctx))) return run(n.args[i + 1], ctx);
        return n.args.length % 2 ? run(n.args[n.args.length - 1], ctx) : null;
      }
      if (name === "prop") {
        if (n.args.length !== 1) throw new Error('prop() takes the property\'s name: prop("Name")');
        return toFormulaValue(ctx.prop(str(run(n.args[0], ctx))));
      }
      const key = Object.keys(FUNCTIONS).find((k) => k.toLowerCase() === name.toLowerCase());
      if (!key) throw new Error(`Unknown function "${name}"`);
      return FUNCTIONS[key](
        n.args.map((a) => run(a, ctx)),
        ctx,
      );
    }
  }
}

/** The function names, for the editor's help. */
export const FORMULA_FUNCTIONS = ["if", "ifs", "prop", ...Object.keys(FUNCTIONS)].sort();

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

/** A formula result as it is stored and shown: dates as ISO text, the rest as it is. */
export function formulaToStored(v: FormulaValue): string | number | boolean | null | (string | number | boolean | null)[] {
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
export function formulaCompletions(src: string, caret: number, props: string[]): { from: number; to: number; items: FormulaCompletion[] } {
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
  if (!word) return { from: caret, to: caret, items: [] };
  const q = word[1];
  const w = q.toLowerCase();
  const fns = FORMULA_FUNCTIONS.filter((f) => f.toLowerCase().startsWith(w) && f !== "prop").map((f) => ({ kind: "function" as const, label: f, insert: `${f}(` }));
  const ps = props.filter((n) => n.toLowerCase().startsWith(w)).map((n) => ({ kind: "property" as const, label: n, insert: `prop(${JSON.stringify(n)})` }));
  return { from: caret - q.length, to: caret, items: [...fns, ...ps] };
}
