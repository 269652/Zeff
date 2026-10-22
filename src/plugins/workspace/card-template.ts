/**
 * Card templates (the Workspace plugin): how a row looks as a card on a board or in a gallery, written in a small language of tags from a
 * fixed list, {{ values | filters }}, {{#if}} and {{#each}}:
 *
 *   <row><b>{{ title }}</b><grow/>{{ key | muted }}</row>
 *   {{ Status | chip }} {{ Due | relative }}
 *   {{#if [Hours booked] > Estimate}} ⚠ over budget {{/if}}
 *   <bar value={{ [Hours booked] }} max={{ Estimate }} />
 *
 * No script and no raw HTML: a template becomes a tree of known nodes (VNode) that the page draws with its own components; a value is
 * text, an address that isn't http(s), mailto or relative is dropped, an attribute not on the tag's list is dropped. Client-safe.
 */
import { evalFormula } from "./formula";
import { cellText, COLORS, noLabels, type Labels, type Property, type Row } from "./model";

export type VNode = string | { t: string; a: Record<string, string>; c: VNode[] };
export type TplError = { line: number; message: string };

export type FilterCall = { name: string; args: (string | number)[] };
export type TNode =
  | { k: "text"; v: string }
  | { k: "out"; expr: string; filters: FilterCall[]; line: number }
  | { k: "tag"; name: string; attrs: [string, string][]; kids: TNode[]; line: number }
  | { k: "if"; cond: string; then: TNode[]; else: TNode[]; line: number }
  | { k: "each"; expr: string; body: TNode[]; line: number };

export const MAX_TEMPLATE = 8000;

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/** Which tags there are, what they take (attribute → how it is checked) and whether they are empty (no closing tag). */
/** A tag's definition: whether it is empty, and what each attribute may be. */
export type TagDef = { void?: boolean; attrs: Record<string, AttrKind> };
/** "text": any words (a label, a name), "list": an expression giving rows or items (not interpolated), "any": every attribute let through as text. */
export type AttrKind = "int" | "url" | "color" | "paint" | "num" | "text" | "list" | { oneOf: string[] };
export const CARD_TAGS: Record<string, TagDef> = {
  row: { attrs: { gap: "int", align: { oneOf: ["start", "center", "end", "baseline"] }, wrap: { oneOf: ["true", "false"] }, justify: { oneOf: ["start", "between", "end"] } } },
  col: { attrs: { gap: "int" } },
  grow: { void: true, attrs: {} },
  hr: { void: true, attrs: {} },
  b: { attrs: {} },
  i: { attrs: {} },
  small: { attrs: {} },
  muted: { attrs: {} },
  code: { attrs: {} },
  clamp: { attrs: { lines: "int" } },
  chip: { attrs: { color: "color" } },
  badge: { attrs: { color: "color" } },
  bar: { void: true, attrs: { value: "num", max: "num", color: "color" } },
  img: { void: true, attrs: { src: "url", h: "int", fit: { oneOf: ["cover", "contain"] }, round: { oneOf: ["true"] } } },
  a: { attrs: { href: "url" } },
};

function readMustache(src: string, i: number): { inner: string; end: number } | null {
  const end = src.indexOf("}}", i + 2);
  return end < 0 ? null : { inner: src.slice(i + 2, end), end: end + 2 };
}

/** Splits `a | b(1, "x") | c` at the single bars (not inside quotes, brackets or parentheses, and not `||`). */
export function splitPipes(s: string): string[] {
  const parts: string[] = [];
  let cur = "";
  let depth = 0;
  let quote = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      cur += c;
      if (c === quote) quote = "";
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    if (c === "(" || c === "[") depth++;
    if (c === ")" || c === "]") depth--;
    if (c === "|" && depth === 0 && s[i + 1] !== "|" && s[i - 1] !== "|") {
      parts.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  parts.push(cur);
  return parts.map((p) => p.trim());
}

export function parseFilter(src: string): FilterCall {
  const m = /^([A-Za-z]+)\s*(?:\(([\s\S]*)\))?$/.exec(src.trim());
  if (!m) throw new Error(`Not a filter: ${src}`);
  const args: (string | number)[] = [];
  if (m[2]?.trim()) {
    let cur = "";
    let quote = "";
    const flush = () => {
      const a = cur.trim();
      cur = "";
      if (!a) return;
      const q = /^(["'])([\s\S]*)\1$/.exec(a);
      args.push(q ? q[2] : Number.isFinite(Number(a)) ? Number(a) : a);
    };
    for (const c of m[2]) {
      if (quote) {
        cur += c;
        if (c === quote) quote = "";
      } else if (c === '"' || c === "'") {
        quote = c;
        cur += c;
      } else if (c === ",") flush();
      else cur += c;
    }
    flush();
  }
  return { name: m[1], args };
}

type Tok =
  | { k: "text"; v: string; at: number }
  | { k: "mus"; inner: string; at: number }
  | { k: "open" | "self" | "close"; name: string; attrs: [string, string][]; at: number };

function parseAttrs(s: string): [string, string][] {
  const out: [string, string][] = [];
  const re = /\s*([a-zA-Z][\w-]*)(?:\s*=\s*("[^"]*"|'[^']*'|\{\{[\s\S]*?\}\}|[^\s"'>]+))?/gy;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) && m[0].length) {
    const raw = m[2] ?? "true";
    out.push([m[1].toLowerCase(), /^(["'])[\s\S]*\1$/.test(raw) ? raw.slice(1, -1) : raw]);
  }
  return out;
}

/** A template's tree (and what is wrong with it) — of a card's tags, or (`tags`) of another set: a view's. */
export function parseTemplate(src: string, tags: Record<string, TagDef> = CARD_TAGS): { nodes: TNode[]; errors: TplError[] } {
  const errors: TplError[] = [];
  const lineAt = (i: number) => src.slice(0, i).split("\n").length;
  const toks: Tok[] = [];
  let text = "";
  let textAt = 0;
  const flush = () => {
    if (text) toks.push({ k: "text", v: text, at: textAt });
    text = "";
  };
  for (let i = 0; i < src.length; ) {
    if (src.startsWith("{{", i)) {
      const m = readMustache(src, i);
      if (!m) {
        errors.push({ line: lineAt(i), message: "A {{ is never closed with }}." });
        break;
      }
      flush();
      toks.push({ k: "mus", inner: m.inner, at: i });
      i = m.end;
      continue;
    }
    if (src[i] === "<") {
      const m = /^<(\/?)([a-zA-Z][a-zA-Z0-9]*)/.exec(src.slice(i, i + 40));
      if (m) {
        let k = i + m[0].length;
        let quote = "";
        let end = -1;
        while (k < src.length) {
          if (!quote && src.startsWith("{{", k)) {
            const e = src.indexOf("}}", k + 2);
            if (e < 0) break;
            k = e + 2;
            continue;
          }
          const c = src[k];
          if (quote) {
            if (c === quote) quote = "";
          } else if (c === '"' || c === "'") quote = c;
          else if (c === ">") {
            end = k;
            break;
          }
          k++;
        }
        if (end < 0) {
          errors.push({ line: lineAt(i), message: `The tag <${m[2]}> is never closed with >.` });
          break;
        }
        flush();
        const inner = src.slice(i + m[0].length, end);
        const selfClosing = !m[1] && /\/\s*$/.test(inner);
        const name = m[2].toLowerCase();
        toks.push({ k: m[1] ? "close" : selfClosing ? "self" : "open", name, attrs: m[1] ? [] : parseAttrs(selfClosing ? inner.replace(/\/\s*$/, "") : inner), at: i });
        i = end + 1;
        continue;
      }
    }
    if (!text) textAt = i;
    text += src[i];
    i++;
  }
  flush();

  type Frame = { kind: "root" | "tag" | "if" | "each"; name?: string; at: number; list: TNode[]; node?: TNode; inElse?: boolean };
  const root: Frame = { kind: "root", at: 0, list: [] };
  const stack: Frame[] = [root];
  const top = () => stack[stack.length - 1];
  const add = (n: TNode) => top().list.push(n);
  for (const t of toks) {
    const line = lineAt(t.at);
    if (t.k === "text") {
      // (Indentation between tags is layout of the source, not content.)
      if (!(/^\s*$/.test(t.v) && t.v.includes("\n"))) add({ k: "text", v: t.v });
    } else if (t.k === "mus") {
      const inner = t.inner.trim();
      let m: RegExpExecArray | null;
      if ((m = /^#if\s+([\s\S]+)$/.exec(inner))) {
        const node: TNode = { k: "if", cond: m[1], then: [], else: [], line };
        add(node);
        stack.push({ kind: "if", at: t.at, list: node.then, node });
      } else if (inner === "#else") {
        const f = top();
        if (f.kind !== "if" || f.inElse) errors.push({ line, message: "{{#else}} without a {{#if}} before it." });
        else {
          f.inElse = true;
          f.list = (f.node as Extract<TNode, { k: "if" }>).else;
        }
      } else if (inner === "/if") {
        if (top().kind === "if") stack.pop();
        else errors.push({ line, message: "{{/if}} without a {{#if}}." });
      } else if ((m = /^#each\s+([\s\S]+)$/.exec(inner))) {
        const node: TNode = { k: "each", expr: m[1], body: [], line };
        add(node);
        stack.push({ kind: "each", at: t.at, list: node.body, node });
      } else if (inner === "/each") {
        if (top().kind === "each") stack.pop();
        else errors.push({ line, message: "{{/each}} without a {{#each}}." });
      } else if (inner.startsWith("#") || inner.startsWith("/")) {
        errors.push({ line, message: `Unknown block {{${inner.split(/\s/)[0]}}} — there are #if, #else and #each.` });
      } else {
        try {
          const [expr, ...fs] = splitPipes(inner);
          if (!expr) throw new Error("Nothing between {{ and }}.");
          add({ k: "out", expr, filters: fs.map(parseFilter), line });
        } catch (e) {
          errors.push({ line, message: (e as Error).message });
        }
      }
    } else if (t.k === "open" || t.k === "self") {
      const def = tags[t.name];
      if (!def) {
        errors.push({ line, message: `Unknown tag <${t.name}> — there are ${Object.keys(tags).map((x) => `<${x}>`).join(" ")}.` });
        continue;
      }
      const node: TNode = { k: "tag", name: t.name, attrs: t.attrs, kids: [], line };
      add(node);
      if (t.k === "open" && !def.void) stack.push({ kind: "tag", name: t.name, at: t.at, list: node.kids, node });
    } else {
      const def = tags[t.name];
      if (!def) {
        errors.push({ line, message: `Unknown tag </${t.name}>.` });
      } else if (def.void) {
        // (</grow> after <grow>: nothing to close.)
      } else if (top().kind === "tag" && top().name === t.name) stack.pop();
      else errors.push({ line, message: top().kind === "tag" ? `Expected </${top().name}> but found </${t.name}>.` : `</${t.name}> has no <${t.name}> before it.` });
    }
  }
  for (const f of stack.slice(1)) errors.push({ line: lineAt(f.at), message: f.kind === "tag" ? `<${f.name}> is never closed.` : `{{#${f.kind}}} is never closed with {{/${f.kind}}}.` });
  return { nodes: root.list, errors };
}

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

export type Field = { value: unknown; text: string; prop: Property | null };
export type CardScope = {
  get: (name: string) => Field | undefined;
  now: Date;
  /** The names a template can use (the help in the editor). */
  names: string[];
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const norm = (s: string) => s.trim().toLowerCase();

function valueOf(p: Property, cell: unknown, text: string): unknown {
  if (cell === undefined || cell === null || cell === "") return null;
  switch (p.type) {
    case "select":
    case "status":
      return p.options?.find((o) => o.id === cell)?.name ?? String(cell);
    case "multi_select":
      return (Array.isArray(cell) ? cell : [cell]).map((x) => p.options?.find((o) => o.id === x)?.name ?? String(x));
    case "checkbox":
      return cell === true;
    case "number":
    case "rollup":
    case "formula":
      return typeof cell === "number" ? cell : typeof cell === "string" && cell.trim() !== "" && !Number.isNaN(Number(cell)) ? Number(cell) : Array.isArray(cell) ? cell : text;
    case "date":
      return typeof cell === "string" ? cell : ((cell as { start?: string })?.start ?? text);
    case "person":
    case "relation":
    case "todo":
      return text ? text.split(", ") : [];
    default:
      return typeof cell === "string" ? cell : text;
  }
}

/** What a template sees of a row: its title, key, id, times and every property by name (or id). `key`: the row's ticket key, if it has one. */
export function cardScope(v: { row: Row; props: Property[]; titleName: string; key?: string | null; labels?: Labels; now?: Date }): CardScope {
  const labels = v.labels ?? noLabels;
  const fields = new Map<string, Field>();
  const set = (name: string, f: Field) => fields.set(norm(name), f);
  for (const p of v.props) {
    const cell = v.row.cells[p.id];
    const text = cell === undefined || cell === null ? "" : cellText(p, cell, labels);
    const f: Field = { value: valueOf(p, cell, text), text, prop: p };
    set(p.id, f);
    set(p.name, f);
  }
  set("title", { value: v.row.title, text: v.row.title, prop: null });
  if (v.titleName) set(v.titleName, { value: v.row.title, text: v.row.title, prop: null });
  set("icon", { value: v.row.icon || null, text: v.row.icon, prop: null });
  set("id", { value: v.row.id, text: String(v.row.id), prop: null });
  set("key", { value: v.key ?? null, text: v.key ?? "", prop: null });
  set("created", { value: v.row.createdAt.slice(0, 10), text: v.row.createdAt.slice(0, 10), prop: null });
  set("updated", { value: v.row.updatedAt.slice(0, 10), text: v.row.updatedAt.slice(0, 10), prop: null });
  return { get: (name) => fields.get(norm(name)), now: v.now ?? new Date(), names: ["title", "key", "id", "icon", "created", "updated", ...v.props.map((p) => p.name)] };
}

// ---------------------------------------------------------------------------
// Expressions: the formulas' language, with the names of properties written as they are (or [in brackets] when they have spaces)
// ---------------------------------------------------------------------------

export const KEYWORDS = new Set(["true", "false", "null", "and", "or", "not"]);

function toFormula(expr: string): string {
  let out = "";
  for (let i = 0; i < expr.length; ) {
    const c = expr[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < expr.length && expr[j] !== c) j += expr[j] === "\\" ? 2 : 1;
      out += JSON.stringify(expr.slice(i + 1, j));
      i = j + 1;
    } else if (c === "[") {
      const j = expr.indexOf("]", i);
      if (j < 0) throw new Error("A [ is never closed with ].");
      out += `prop(${JSON.stringify(expr.slice(i + 1, j).trim())})`;
      i = j + 1;
    } else if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < expr.length && /\w/.test(expr[j])) j++;
      const w = expr.slice(i, j);
      out += KEYWORDS.has(w.toLowerCase()) || expr.slice(j).trimStart()[0] === "(" ? w : `prop(${JSON.stringify(w)})`;
      i = j;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

export type Ctx = { scope: CardScope; locals: Map<string, Field>; errors: TplError[] };
const lookup = (ctx: Ctx, name: string): Field | undefined => ctx.locals.get(norm(name)) ?? ctx.scope.get(name);

function evaluate(expr: string, ctx: Ctx, line: number): unknown {
  try {
    const r = evalFormula(toFormula(expr), { now: ctx.scope.now, prop: (name) => lookup(ctx, name)?.value ?? null });
    if ("error" in r) throw new Error(r.error);
    return r.value;
  } catch (e) {
    ctx.errors.push({ line, message: `${expr.trim()}: ${(e as Error).message}` });
    return null;
  }
}

const truthy = (v: unknown): boolean => !(v === null || v === undefined || v === "" || v === false || v === 0 || (Array.isArray(v) && v.length === 0));

/** The first thing of an output: a bare name is its Field (so filters know its property), anything else its value. */
function first(expr: string, ctx: Ctx, line: number): unknown {
  const bare = /^\[([^\]]+)\]$/.exec(expr.trim())?.[1] ?? (/^[A-Za-z_]\w*$/.test(expr.trim()) ? expr.trim() : null);
  const f = bare ? lookup(ctx, bare) : undefined;
  if (f) return f;
  if (bare && !KEYWORDS.has(bare.toLowerCase())) {
    ctx.errors.push({ line, message: `There is no property “${bare}”.` });
    return null;
  }
  const v = evaluate(expr, ctx, line);
  return v instanceof Date ? v.toISOString().slice(0, 10) : v;
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export const isField = (v: unknown): v is Field => !!v && typeof v === "object" && "prop" in (v as object) && "text" in (v as object);
export const isNode = (v: unknown): v is VNode => typeof v === "string" || (!!v && typeof v === "object" && "t" in (v as object));
export const textOf = (v: unknown): string => (v === null || v === undefined ? "" : isField(v) ? v.text : typeof v === "string" ? v : Array.isArray(v) ? v.map(textOf).join(", ") : typeof v === "object" ? "" : String(v));
export const numOf = (v: unknown): number | null => {
  const x = isField(v) ? v.value : v;
  const n = typeof x === "number" ? x : typeof x === "string" && x.trim() !== "" ? Number(x) : NaN;
  return Number.isNaN(n) ? null : n;
};
const listOf = (v: unknown): unknown[] => (isField(v) ? (Array.isArray(v.value) ? v.value : v.value === null ? [] : [v.value]) : Array.isArray(v) ? v : v === null || v === undefined || v === "" ? [] : [v]);
const empty = (v: unknown): boolean => (isField(v) ? v.value === null || v.value === "" || (Array.isArray(v.value) && !v.value.length) : v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length));
const node = (t: string, a: Record<string, string>, c: VNode[]): VNode => ({ t, a, c });
const asNodes = (v: unknown): VNode[] => (Array.isArray(v) && v.every(isNode) && v.length ? (v as VNode[]) : empty(v) ? [] : [textOf(v)]);

const rounded = (n: number, d = 2) => String(Math.round(n * 10 ** d) / 10 ** d);
function dayOf(v: unknown): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(textOf(v));
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

export const FILTERS: Record<string, (v: unknown, a: (string | number)[], ctx: Ctx) => unknown> = {
  chip: (v) => {
    const f = isField(v) ? v : null;
    return listOf(v).map((x) => {
      const name = String(x);
      const color = f?.prop?.options?.find((o) => o.name === name)?.color ?? "gray";
      return node("chip", { color }, [name]);
    });
  },
  date: (v, _a, ctx) => {
    const d = dayOf(v);
    if (!d) return textOf(v);
    return `${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() === ctx.scope.now.getFullYear() ? "" : ` ${d.getFullYear()}`}`;
  },
  relative: (v, _a, ctx) => {
    const d = dayOf(v);
    if (!d) return textOf(v);
    const t0 = new Date(ctx.scope.now.getFullYear(), ctx.scope.now.getMonth(), ctx.scope.now.getDate());
    const n = Math.round((d.getTime() - t0.getTime()) / 864e5);
    return n === 0 ? "today" : n > 0 ? `in ${n} day${n === 1 ? "" : "s"}` : `${-n} day${n === -1 ? "" : "s"} ago`;
  },
  hours: (v) => (numOf(v) === null ? "" : `${rounded(numOf(v)!)} h`),
  number: (v, a) => (numOf(v) === null ? "" : rounded(numOf(v)!, typeof a[0] === "number" ? a[0] : 2)),
  percent: (v) => (numOf(v) === null ? "" : `${Math.round(numOf(v)! * 100)}%`),
  euro: (v) => (numOf(v) === null ? "" : `${rounded(numOf(v)!)} €`),
  upper: (v) => textOf(v).toUpperCase(),
  lower: (v) => textOf(v).toLowerCase(),
  truncate: (v, a) => {
    const s = textOf(v);
    const n = typeof a[0] === "number" ? a[0] : 40;
    return s.length > n ? `${s.slice(0, n)}…` : s;
  },
  clamp: (v, a) => (empty(v) ? "" : node("clamp", { lines: String(typeof a[0] === "number" ? a[0] : 3) }, [textOf(v)])),
  default: (v, a) => (empty(v) ? String(a[0] ?? "") : v),
  join: (v, a) => listOf(v).map(textOf).join(String(a[0] ?? ", ")),
  first: (v) => textOf(listOf(v)[0]),
  last: (v) => textOf(listOf(v).at(-1)),
  count: (v) => String(listOf(v).length),
  check: (v) => (isField(v) ? v.value === true : v === true) ? "✓" : "",
  bold: (v) => (empty(v) ? "" : node("b", {}, asNodes(v))),
  muted: (v) => (empty(v) ? "" : node("muted", {}, asNodes(v))),
  small: (v) => (empty(v) ? "" : node("small", {}, asNodes(v))),
  code: (v) => (empty(v) ? "" : node("code", {}, [textOf(v)])),
  link: (v) => (empty(v) ? "" : node("a", { href: textOf(v) }, [textOf(v).replace(/^https?:\/\/(www\.)?/, "").slice(0, 40)])),
  img: (v, a) => (empty(v) ? "" : node("img", { src: textOf(v), ...(typeof a[0] === "number" ? { h: String(a[0]) } : {}), fit: "cover" }, [])),
  bar: (v, a) => (numOf(v) === null ? "" : node("bar", { value: String(numOf(v)), max: String(typeof a[0] === "number" ? a[0] : 1) }, [])),
  initials: (v) => textOf(v).split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join(""),
};

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

/** An address a card may link to or show: http(s), mailto, or one of Zeff's own (relative). */
export const safeUrl = (s: string): string => (/^(https?:\/\/|mailto:|\/(?!\/)|#)/i.test(s.trim()) ? s.trim() : "");

function interpolate(raw: string, ctx: Ctx, line: number): string {
  return raw.replace(/\{\{([\s\S]*?)\}\}/g, (_m, inner: string) => {
    const [expr, ...fs] = splitPipes(inner.trim());
    let v: unknown = first(expr, ctx, line);
    for (const f of fs) {
      try {
        const call = parseFilter(f);
        const fn = FILTERS[call.name];
        if (!fn) throw new Error(`There is no filter “${call.name}”.`);
        v = fn(v, call.args, ctx);
      } catch (e) {
        ctx.errors.push({ line, message: (e as Error).message });
      }
    }
    return Array.isArray(v) && v.every(isNode) ? v.map((n) => (typeof n === "string" ? n : textOf(n.c))).join(", ") : isNode(v) && typeof v !== "string" ? textOf(v.c) : textOf(v);
  });
}

export function checkAttr(kind: AttrKind, v: string): string | null {
  const s = v.trim();
  if (kind === "text" || kind === "list") return s.slice(0, 500);
  if (kind === "int") return /^\d{1,3}$/.test(s) ? s : null;
  if (kind === "num") return s !== "" && Number.isFinite(Number(s)) ? s : null;
  if (kind === "color") return (COLORS as readonly string[]).includes(s) ? s : null;
  // A colour by name, or as #rgb / #rrggbb (a creditor's, an item's own).
  if (kind === "paint") return (COLORS as readonly string[]).includes(s) || /^#[0-9a-f]{3,8}$/i.test(s) ? s : null;
  if (kind === "url") return safeUrl(s) || null;
  return kind.oneOf.includes(s) ? s : null;
}

function drawList(list: TNode[], ctx: Ctx): VNode[] {
  const out: VNode[] = [];
  for (const n of list) {
    if (n.k === "text") out.push(n.v);
    else if (n.k === "out") {
      let v: unknown = first(n.expr, ctx, n.line);
      for (const f of n.filters) {
        const fn = FILTERS[f.name];
        if (!fn) {
          ctx.errors.push({ line: n.line, message: `There is no filter “${f.name}”.` });
          continue;
        }
        v = fn(v, f.args, ctx);
      }
      if (Array.isArray(v) && v.length && v.every(isNode)) out.push(...(v as VNode[]));
      else if (isNode(v) && typeof v !== "string") out.push(v);
      else {
        const s = textOf(v);
        if (s) out.push(s);
      }
    } else if (n.k === "if") {
      out.push(...drawList(truthy(evaluate(n.cond, ctx, n.line)) ? n.then : n.else, ctx));
    } else if (n.k === "each") {
      const f = n.expr.trim().replace(/^\[([^\]]+)\]$/, "$1");
      const field = lookup(ctx, f);
      if (!field) {
        ctx.errors.push({ line: n.line, message: `There is no property “${f}”.` });
        continue;
      }
      for (const item of listOf(field)) {
        const locals = new Map(ctx.locals);
        locals.set("this", { value: item, text: String(item), prop: field.prop });
        out.push(...drawList(n.body, { ...ctx, locals }));
      }
    } else {
      const def = CARD_TAGS[n.name];
      const a: Record<string, string> = {};
      for (const [k, raw] of n.attrs) {
        const kind = def.attrs[k];
        if (!kind) continue; // (not on the tag's list: dropped)
        const ok = checkAttr(kind, interpolate(raw, ctx, n.line));
        if (ok !== null) a[k] = ok;
      }
      out.push({ t: n.name, a, c: drawList(n.kids, ctx) });
    }
  }
  return out;
}

/** A template drawn for one row: the nodes, and what went wrong on the way (an unknown property or filter, an expression that doesn't parse). */
export function renderTemplate(nodes: TNode[], scope: CardScope): { nodes: VNode[]; errors: TplError[] } {
  const ctx: Ctx = { scope, locals: new Map(), errors: [] };
  const out = drawList(nodes, ctx);
  const seen = new Set<string>();
  return { nodes: out, errors: ctx.errors.filter((e) => (seen.has(`${e.line}:${e.message}`) ? false : (seen.add(`${e.line}:${e.message}`), true))) };
}

/** Nodes as a line of text (tests, the editor's copy of the result). */
export function vnodeToString(nodes: VNode[] | VNode): string {
  const one = (n: VNode): string => (typeof n === "string" ? n : `<${n.t}${Object.entries(n.a).map(([k, v]) => ` ${k}=${v}`).join("")}>${n.c.map(one).join("")}</${n.t}>`);
  return (Array.isArray(nodes) ? nodes : [nodes]).map(one).join("");
}

const cache = new Map<string, ReturnType<typeof parseTemplate>>();
/** parseTemplate, remembered (a board draws the same template for every card). */
export function parsedTemplate(src: string): ReturnType<typeof parseTemplate> {
  let p = cache.get(src);
  if (!p) {
    p = parseTemplate(src.slice(0, MAX_TEMPLATE));
    if (cache.size > 50) cache.clear();
    cache.set(src, p);
  }
  return p;
}

/** A starting template made of the database's own properties: the title and key, the first choices as chips, a date, a number, a passage. */
export function starterTemplate(props: Property[]): string {
  const ref = (p: Property) => (/^[A-Za-z_]\w*$/.test(p.name) ? p.name : `[${p.name}]`);
  const choices = props.filter((p) => p.type === "status" || p.type === "select" || p.type === "multi_select").slice(0, 2);
  const date = props.find((p) => p.type === "date");
  const num = props.find((p) => p.type === "number" || p.type === "rollup");
  const text = props.find((p) => p.type === "text" || p.type === "markdown" || p.type === "ai");
  return [
    "<row><b>{{ title }}</b><grow/>{{ key | muted }}</row>",
    ...(choices.length ? [`<row gap=1>${choices.map((p) => `{{ ${ref(p)} | chip }}`).join(" ")}</row>`] : []),
    ...(text ? [`{{ ${ref(text)} | clamp(3) }}`] : []),
    ...(date || num ? [`<row>${[date ? `{{ ${ref(date)} | date }}` : "", num ? `<grow/>{{ ${ref(num)} }}` : ""].filter(Boolean).join(" ")}</row>`] : []),
  ].join("\n");
}
