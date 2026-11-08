import { evalFormula } from "../formula";

/**
 * The expressions of a flow: {{ steps.search.hits[0].id }}, {{ input.q | trim | default('…') }}, {{ steps.n.count > 3 and not
 * vars.done }}. A path reads the run's values as they are (objects and lists stay); anything else is the formulas' language with
 * the paths as its names; filters after | shape the value. A text with several {{ }} becomes a text; a text that is only one
 * {{ … }} becomes that value. Pure and client-safe (the Studio checks expressions with it).
 */

export type Scope = Record<string, unknown>;

const PATH = /^[\p{L}_$][\p{L}\p{N}_$]*(?:\.[\p{L}\p{N}_$-]+|\[\s*(?:-?\d+|'[^']*'|"[^"]*")\s*\])*$/u;

/** A path's parts: steps.search.hits[0]["a b"] → ["steps", "search", "hits", 0, "a b"]. */
export function pathParts(path: string): (string | number)[] {
  const out: (string | number)[] = [];
  const re = /\[\s*(-?\d+)\s*\]|([\p{L}\p{N}_$-]+)|\[\s*'([^']*)'\s*\]|\[\s*"([^"]*)"\s*\]/gu;
  for (const m of path.matchAll(re)) out.push(m[1] !== undefined ? Number(m[1]) : m[2] !== undefined ? m[2] : (m[3] ?? m[4]));
  return out;
}

/** The value at a path (undefined: not there). A negative index counts from the end. */
export function readPath(scope: Scope, path: string): unknown {
  let v: unknown = scope;
  for (const k of pathParts(path)) {
    if (v === null || v === undefined) return undefined;
    if (Array.isArray(v)) v = typeof k === "number" ? v.at(k) : k === "length" ? v.length : undefined;
    else if (typeof v === "object") v = (v as Record<string, unknown>)[String(k)];
    else if (typeof v === "string" && k === "length") v = v.length;
    else return undefined;
  }
  return v;
}

const isPath = (s: string) => PATH.test(s) && !/^(true|false|null|and|or|not)$/i.test(s);

/** Splits at the | that aren't inside quotes, brackets or parentheses (and not ||). */
function splitPipes(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = "";
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === "\\") (cur += c + (s[i + 1] ?? ""), i++);
      else (c === quote && (quote = ""), (cur += c));
      continue;
    }
    if (c === "'" || c === '"') quote = c;
    else if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
    else if (c === "|" && depth === 0 && s[i + 1] !== "|" && s[i - 1] !== "|") {
      parts.push(cur.trim());
      cur = "";
      continue;
    }
    cur += c;
  }
  parts.push(cur.trim());
  return parts;
}

/** A filter's call and what follows it: "count > 1" → ["count", "> 1"], "default('a') == 'b'" → ["default('a')", "== 'b'"]. */
function splitCall(s: string): [string, string] {
  const m = /^\s*[\p{L}_][\p{L}\p{N}_]*\s*/u.exec(s);
  if (!m) return [s, ""];
  let end = m[0].length;
  if (s[end] === "(") {
    let depth = 0;
    let quote = "";
    for (let i = end; i < s.length; i++) {
      const c = s[i];
      if (quote) (c === quote && (quote = ""));
      else if (c === "'" || c === '"') quote = c;
      else if (c === "(") depth++;
      else if (c === ")" && --depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  return [s.slice(0, end).trim(), s.slice(end).trim()];
}

/** A filter call's name and arguments: default('—'), join(", "), slice(0, 3). Arguments are expressions too. */
function parseCall(s: string, scope: Scope): { name: string; args: unknown[] } {
  const m = /^([\p{L}_][\p{L}\p{N}_]*)\s*(?:\(([\s\S]*)\))?$/u.exec(s.trim());
  if (!m) throw new Error(`“${s}” is no filter.`);
  const args: unknown[] = [];
  if (m[2]?.trim()) {
    let depth = 0;
    let quote = "";
    let cur = "";
    for (const c of m[2]) {
      if (quote) (c === quote && (quote = ""), (cur += c));
      else if (c === "'" || c === '"') ((quote = c), (cur += c));
      else if (c === "(" || c === "[") (depth++, (cur += c));
      else if (c === ")" || c === "]") (depth--, (cur += c));
      else if (c === "," && depth === 0) (args.push(evalExpr(cur, scope)), (cur = ""));
      else cur += c;
    }
    args.push(evalExpr(cur, scope));
  }
  return { name: m[1], args };
}

export const text = (v: unknown): string => (v === null || v === undefined ? "" : typeof v === "string" ? v : typeof v === "object" ? JSON.stringify(v) : String(v));

const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === null || v === undefined || v === "" ? [] : [v]);

export const FLOW_FILTERS: Record<string, { what: string; fn: (v: unknown, ...a: unknown[]) => unknown }> = {
  json: { what: "the value as JSON text", fn: (v) => JSON.stringify(v ?? null) },
  parse: { what: "JSON text as a value", fn: (v) => (typeof v === "string" ? JSON.parse(v) : v) },
  text: { what: "as text", fn: (v) => text(v) },
  trim: { what: "without spaces around", fn: (v) => text(v).trim() },
  upper: { what: "in capitals", fn: (v) => text(v).toUpperCase() },
  lower: { what: "in small letters", fn: (v) => text(v).toLowerCase() },
  number: { what: "as a number (null if it isn't one)", fn: (v) => (v === "" || v === null || v === undefined || !Number.isFinite(Number(String(v).replace(",", "."))) ? null : Number(String(v).replace(",", "."))) },
  round: { what: "round(2): rounded to that many digits", fn: (v, d) => Math.round(Number(v) * 10 ** Number(d ?? 0)) / 10 ** Number(d ?? 0) },
  default: { what: "default('x'): this when it is empty", fn: (v, d) => (v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length) ? d : v) },
  first: { what: "the first item", fn: (v) => list(v)[0] ?? null },
  last: { what: "the last item", fn: (v) => list(v).at(-1) ?? null },
  count: { what: "how many items (a text: its length)", fn: (v) => (typeof v === "string" ? v.length : v && typeof v === "object" && !Array.isArray(v) ? Object.keys(v).length : list(v).length) },
  join: { what: "join(', '): the items as one text", fn: (v, sep) => list(v).map(text).join(sep === undefined ? ", " : text(sep)) },
  split: { what: "split(','): a text cut into a list", fn: (v, sep) => text(v).split(sep === undefined ? "," : text(sep)).map((s) => s.trim()).filter(Boolean) },
  lines: { what: "a text's lines as a list", fn: (v) => text(v).split(/\r?\n/).map((s) => s.trim()).filter(Boolean) },
  slice: { what: "slice(0, 5): part of a list or text", fn: (v, a, b) => (typeof v === "string" ? v.slice(Number(a ?? 0), b === undefined ? undefined : Number(b)) : list(v).slice(Number(a ?? 0), b === undefined ? undefined : Number(b))) },
  pluck: { what: "pluck('title'): that field of every item", fn: (v, k) => list(v).map((x) => (x && typeof x === "object" ? (x as Record<string, unknown>)[text(k)] : null)) },
  where: { what: "where('field', value): the items whose field is that value (where('field'): is filled)", fn: (v, k, want) => list(v).filter((x) => { const f = x && typeof x === "object" ? (x as Record<string, unknown>)[text(k)] : undefined; return want === undefined ? !!f : text(f) === text(want); }) },
  sort: { what: "sort('field', 'desc')", fn: (v, k, dir) => [...list(v)].sort((a, b) => { const x = k ? (a as Record<string, unknown>)?.[text(k)] : a; const y = k ? (b as Record<string, unknown>)?.[text(k)] : b; const c = typeof x === "number" && typeof y === "number" ? x - y : text(x).localeCompare(text(y), undefined, { numeric: true }); return dir === "desc" ? -c : c; }) },
  unique: { what: "without repeats", fn: (v) => [...new Map(list(v).map((x) => [text(x), x])).values()] },
  keys: { what: "an object's keys", fn: (v) => (v && typeof v === "object" ? Object.keys(v) : []) },
  values: { what: "an object's values", fn: (v) => (v && typeof v === "object" ? Object.values(v) : []) },
  sum: { what: "the sum (sum('field'): of that field)", fn: (v, k) => list(v).reduce<number>((s, x) => s + (Number(k ? (x as Record<string, unknown>)?.[text(k)] : x) || 0), 0) },
  urlencode: { what: "for an address's query", fn: (v) => encodeURIComponent(text(v)) },
  date: { what: "the day (YYYY-MM-DD)", fn: (v) => { const d = new Date(text(v)); return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10); } },
  truncate: { what: "truncate(80): at most that many characters", fn: (v, n) => { const s = text(v); const m = Number(n ?? 80); return s.length > m ? `${s.slice(0, m - 1)}…` : s; } },
  replace: { what: "replace('a', 'b')", fn: (v, a, b) => text(v).split(text(a)).join(text(b)) },
  stripHtml: { what: "a text without its HTML tags", fn: (v) => text(v).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() },
};

/** An expression in the formulas' language whose names are the run's paths. */
function toFormula(expr: string): string {
  let out = "";
  for (let i = 0; i < expr.length; ) {
    const c = expr[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < expr.length && expr[j] !== c) j += expr[j] === "\\" ? 2 : 1;
      out += JSON.stringify(expr.slice(i + 1, j));
      i = j + 1;
    } else if (/[\p{L}_$]/u.test(c)) {
      let j = i;
      while (j < expr.length && /[\p{L}\p{N}_$.]/u.test(expr[j])) j++;
      // An index after it belongs to the path: hits[0].id
      while (expr[j] === "[") {
        const k = expr.indexOf("]", j);
        if (k < 0) break;
        j = k + 1;
        while (j < expr.length && /[\p{L}\p{N}_$.]/u.test(expr[j])) j++;
      }
      const w = expr.slice(i, j);
      out += /^(true|false|null|and|or|not)$/i.test(w) || expr.slice(j).trimStart()[0] === "(" ? w : `prop(${JSON.stringify(w)})`;
      i = j;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** An expression's value: a path, a literal or a formula, then its filters. */
export function evalExpr(src: string, scope: Scope): unknown {
  const [head, ...filters] = splitPipes(src.trim());
  let v: unknown;
  if (head === "") v = null;
  else if (isPath(head)) v = readPath(scope, head) ?? null;
  else if (/^-?\d+(\.\d+)?$/.test(head)) v = Number(head);
  else if (/^'[^']*'$|^"[^"]*"$/.test(head)) v = head.slice(1, -1);
  else if (/^[[{]/.test(head)) v = JSON.parse(head);
  else {
    const r = evalFormula(toFormula(head), {
      prop: (name) => {
        const x = readPath(scope, name);
        if (x === undefined) return null;
        return x !== null && typeof x === "object" && !Array.isArray(x) ? true : x;
      },
    });
    if ("error" in r) throw new Error(`${head}: ${r.error}`);
    v = r.value instanceof Date ? r.value.toISOString() : r.value;
  }
  for (const f of filters) {
    // (A comparison after the last filter applies to its value: hits | count > 1.)
    const [call, rest] = splitCall(f);
    const { name, args } = parseCall(call, scope);
    const def = FLOW_FILTERS[name];
    if (!def) throw new Error(`There is no filter “${name}” — there are ${Object.keys(FLOW_FILTERS).join(", ")}.`);
    v = def.fn(v, ...args);
    if (rest) v = evalExpr(`__value ${rest}`, { ...scope, __value: v });
  }
  return v;
}

const ONE = /^\s*\{\{([\s\S]*?)\}\}\s*$/;

/** A node's input made real: texts' {{ }} filled in (one alone: its value as it is), lists and objects through and through. */
export function fill(v: unknown, scope: Scope): unknown {
  if (typeof v === "string") {
    if (!v.includes("{{")) return v;
    const one = ONE.exec(v);
    if (one && !one[1].includes("}}")) return evalExpr(one[1], scope);
    return v.replace(/\{\{([\s\S]*?)\}\}/g, (_, e: string) => text(evalExpr(e, scope)));
  }
  if (Array.isArray(v)) return v.map((x) => fill(x, scope));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x, scope)]));
  return v;
}

export const truthy = (v: unknown): boolean => !(v === null || v === undefined || v === false || v === "" || v === 0 || (Array.isArray(v) && v.length === 0));

/** A condition: a bare expression or one in {{ }}. */
export const holds = (cond: string, scope: Scope): boolean => truthy(evalExpr(cond.trim().replace(/^\{\{([\s\S]*)\}\}$/, "$1"), scope));

/** The errors an expression has, found without running it (paths are not checked: what they read is only there at run time). */
export function checkExpr(src: string): string | null {
  try {
    evalExpr(src, new Proxy({}, { get: () => undefined }) as Scope);
    return null;
  } catch (e) {
    const m = (e as Error).message;
    return /no filter|is no filter|Unexpected|unexpected|expected/i.test(m) ? m : null;
  }
}
