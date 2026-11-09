/**
 * Exercise sets — what an agent (the Learn teacher) writes instead of a whole widget: a plain object the exercise kit
 * (kit/kit.js, in every widget's frame) turns into a card stack with instant feedback, hints, a second try, the answer
 * shown when it didn't work out, a summary with "the wrong ones again", and the report (score, answers, done).
 * checkSpec says exactly what's wrong (the agent fixes it at once); specHtml makes the widget's HTML. Client-safe (pure).
 *
 * Every item: { type, q?, hint?, explain?, media? (inline <svg> or a data:image URL), points? (weight, 1) } and:
 *   choice      options: string[], answer: index | index[] (several right: multiple choice), why?: per option, shuffle?
 *   number      answer: number, tol? (absolute), rel? (0.01 = 1 %), unit?, units? ({ "mm": 0.001 } → factor to unit)
 *   text        answer: string | string[], match?: "loose" (default: case, accents, one typo) | "exact" | "regex" | "keywords", long?
 *   formula     answer: "2*x*cos(x^2)", vars? (["x"]), range? ([-3, 3]) — compared as functions, not as text
 *   cloze       text: "Die {{Hauptstadt|Kapitale}} ist {{[Paris|*Berlin|Rom]}}." (blanks; [..|*right|..] a choice)
 *   order       items: string[] in the right order (shown mixed)
 *   match       pairs: [left, right][]
 *   categorize  groups: { "group": ["item", …] }
 *   hotspot     image: inline <svg> | data:image URL, spots: [{ label, x, y (in % of the picture), r? (% of its width, 8) }]
 *   slider      min, max, step?, answer, tol?, unit?, start?
 *   code        tests: [{ call: "add(2, 3)", expect: 5 }], starter?, solution? — JavaScript, run in a worker, 2 s at most
 *   table       columns?: string[], rows: (string | { answer: number | string, tol?, unit?, match? })[][]
 *   plot        fn: "a*sin(b*x)", params: { a: { min, max, step?, value? } }, x?: [min, max], y?: [min, max],
 *               target?: { a: 2 } (graded: onto the dashed curve, tol? relative 0.05) — without: to explore
 *   scenario    start?, nodes: { id: { text, choices: [{ label, to, feedback? }] } | { text, end: true, score: 0..1 } }
 *   cards       cards: [{ front, back }] — self-check
 * The set: { title, intro?, items, lang? ("de" | "en" | "es"), tries? (2), pass? (0.8) }.
 */

export const ITEM_TYPES = ["choice", "number", "text", "formula", "cloze", "order", "match", "categorize", "hotspot", "slider", "code", "table", "plot", "scenario", "cards"] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

export type ExerciseItem = { type: ItemType; q?: string; hint?: string; explain?: string; media?: string; points?: number } & Record<string, unknown>;
export type ExerciseSet = { title?: string; intro?: string; items: ExerciseItem[]; lang?: string; tries?: number; pass?: number };

/** The most items a set may have. */
export const MAX_ITEMS = 40;

const isStr = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const strs = (v: unknown, min = 1): v is string[] => Array.isArray(v) && v.length >= min && v.every(isStr);
const isPic = (v: unknown) => typeof v === "string" && (/^\s*<svg[\s>]/i.test(v) || /^data:image\/(png|jpe?g|gif|webp|svg\+xml);/.test(v));

/** What's wrong with one item ("" when nothing). */
function itemProblem(it: ExerciseItem): string {
  if (!it || typeof it !== "object") return "not an object";
  if (!ITEM_TYPES.includes(it.type)) return `unknown type "${String(it.type)}" (types: ${ITEM_TYPES.join(", ")})`;
  if (it.media !== undefined && !isPic(it.media)) return "media must be inline <svg …> or a data:image URL (nothing is loaded from the network)";
  const a = it.answer;
  const needQ = it.type !== "cloze" && it.type !== "scenario" && it.type !== "cards" && it.type !== "plot";
  if (needQ && !isStr(it.q)) return "q (the task) is missing";
  switch (it.type) {
    case "choice": {
      if (!strs(it.options, 2)) return "options: at least two texts";
      const n = (it.options as string[]).length;
      const idx = Array.isArray(a) ? a : [a];
      if (!idx.length || !idx.every((i) => Number.isInteger(i) && (i as number) >= 0 && (i as number) < n)) return `answer: the index of the right option (0…${n - 1}), or a list of indexes`;
      if (it.why !== undefined && !(Array.isArray(it.why) && it.why.length <= n)) return "why: one text per option (or leave it out)";
      return "";
    }
    case "number":
      if (!isNum(a)) return "answer: a number";
      if (it.tol !== undefined && !isNum(it.tol)) return "tol: a number";
      if (it.rel !== undefined && !isNum(it.rel)) return "rel: a number (0.01 = 1 %)";
      if (it.units !== undefined && (typeof it.units !== "object" || Object.values(it.units as object).some((f) => !isNum(f)))) return 'units: { "mm": 0.001 } — factors to the unit';
      return "";
    case "text":
      if (!(isStr(a) || strs(a))) return "answer: a text or a list of texts";
      if (it.match !== undefined && !["loose", "exact", "regex", "keywords"].includes(String(it.match))) return 'match: "loose", "exact", "regex" or "keywords"';
      if (it.match === "regex")
        for (const p of ([] as unknown[]).concat(a))
          try {
            new RegExp(String(p), "i");
          } catch {
            return `answer: "${String(p)}" isn't a valid pattern`;
          }
      return "";
    case "formula":
      if (!isStr(a)) return 'answer: the formula, e.g. "2*x*cos(x^2)"';
      if (it.vars !== undefined && !strs(it.vars)) return 'vars: the variables, e.g. ["x", "t"]';
      return "";
    case "cloze":
      if (!isStr(it.text) || !/\{\{.+?\}\}/.test(it.text)) return 'text: with blanks — "{{answer|other}}" or a choice "{{[wrong|*right]}}"';
      return "";
    case "order":
      return strs(it.items, 2) ? "" : "items: at least two, in the right order";
    case "match":
      return Array.isArray(it.pairs) && it.pairs.length >= 2 && it.pairs.every((p) => Array.isArray(p) && p.length === 2 && isStr(p[0]) && isStr(p[1])) ? "" : 'pairs: [["left", "right"], …] — at least two';
    case "categorize": {
      const g = it.groups as Record<string, unknown> | undefined;
      if (!g || typeof g !== "object" || Object.keys(g).length < 2) return 'groups: { "group": ["item", …] } — at least two groups';
      return Object.values(g).every((x) => strs(x)) ? "" : "groups: each a list of items";
    }
    case "hotspot":
      if (!isPic(it.image)) return "image: inline <svg …> or a data:image URL";
      return Array.isArray(it.spots) && it.spots.length > 0 && it.spots.every((s) => s && isStr(s.label) && isNum(s.x) && isNum(s.y) && s.x >= 0 && s.x <= 100 && s.y >= 0 && s.y <= 100)
        ? ""
        : "spots: [{ label, x, y }] — x and y in % of the picture (0–100)";
    case "slider":
      if (!isNum(it.min) || !isNum(it.max) || it.min >= it.max) return "min < max: numbers";
      return isNum(a) && a >= it.min && a <= it.max ? "" : "answer: a number between min and max";
    case "code":
      return Array.isArray(it.tests) && it.tests.length > 0 && it.tests.every((x) => x && isStr(x.call) && "expect" in x) ? "" : 'tests: [{ call: "add(2, 3)", expect: 5 }]';
    case "table": {
      if (!Array.isArray(it.rows) || !it.rows.length || !it.rows.every((r) => Array.isArray(r))) return "rows: a list of rows (each a list of cells)";
      const inputs = (it.rows as unknown[][]).flat().filter((c) => c && typeof c === "object");
      if (!inputs.length) return "rows: at least one cell to fill in — { answer: … }";
      return inputs.every((c) => isNum((c as { answer?: unknown }).answer) || isStr((c as { answer?: unknown }).answer)) ? "" : "a cell to fill in: { answer: number or text }";
    }
    case "plot": {
      if (!isStr(it.fn)) return 'fn: the function of x, e.g. "a*sin(b*x)"';
      const ps = (it.params ?? {}) as Record<string, { min?: unknown; max?: unknown }>;
      if (typeof ps !== "object" || Object.values(ps).some((p) => !p || !isNum(p.min) || !isNum(p.max) || (p.min as number) >= (p.max as number))) return "params: { a: { min, max } } — numbers, min < max";
      if (it.target !== undefined && (typeof it.target !== "object" || Object.keys(it.target as object).some((k) => !(k in ps)))) return "target: values for the params only";
      return "";
    }
    case "scenario": {
      const nodes = it.nodes as Record<string, { text?: unknown; end?: unknown; choices?: { label?: unknown; to?: unknown }[] }> | undefined;
      if (!nodes || typeof nodes !== "object" || !Object.keys(nodes).length) return "nodes: { id: { text, choices: [{ label, to }] } }";
      if (it.start !== undefined && !(String(it.start) in nodes)) return `start: no node "${String(it.start)}"`;
      for (const [id, n] of Object.entries(nodes)) {
        if (!n || !isStr(n.text)) return `node "${id}": text is missing`;
        if (n.end) continue;
        if (!Array.isArray(n.choices) || !n.choices.length) return `node "${id}": choices (or end: true with a score)`;
        const bad = n.choices.find((c) => !c || !isStr(c.label) || !(String(c.to) in nodes));
        if (bad) return `node "${id}": a choice leads to "${String(bad?.to)}", which isn't a node`;
      }
      return Object.values(nodes).some((n) => n.end) ? "" : "nodes: at least one end (end: true, score: 0..1)";
    }
    case "cards":
      return Array.isArray(it.cards) && it.cards.length > 0 && it.cards.every((c) => c && isStr(c.front) && isStr(c.back)) ? "" : "cards: [{ front, back }]";
  }
  return "";
}

/** What's wrong with a set — each problem as "item 3 (number): answer: a number"; [] when it's fine. */
export function checkSpec(spec: unknown): string[] {
  if (!spec || typeof spec !== "object") return ["the set must be an object: { title, items: [...] }"];
  const s = spec as ExerciseSet;
  if (!Array.isArray(s.items) || !s.items.length) return ["items: at least one"];
  if (s.items.length > MAX_ITEMS) return [`items: at most ${MAX_ITEMS} (split it into two widgets)`];
  const out: string[] = [];
  s.items.forEach((it, i) => {
    const p = itemProblem(it);
    if (p) out.push(`item ${i + 1}${it && typeof it === "object" && it.type ? ` (${String(it.type)})` : ""}: ${p}`);
  });
  if (s.tries !== undefined && !(isNum(s.tries) && s.tries >= 1 && s.tries <= 5)) out.push("tries: 1–5");
  if (s.pass !== undefined && !(isNum(s.pass) && s.pass > 0 && s.pass <= 1)) out.push("pass: a share, 0..1");
  return out;
}

/** Whether a set's text has math in it ($…$) — then the widget gets KaTeX. */
export const specHasMath = (spec: ExerciseSet) => /\$[^$]+\$/.test(JSON.stringify(spec));

/** A set as a widget's HTML: the set as JSON (it can't close its tag), mounted by the kit. */
export function specHtml(spec: ExerciseSet): string {
  const bs = String.fromCharCode(92); // a backslash
  const json = JSON.stringify(spec)
    .replace(/</g, `${bs}u003c`)
    .replace(new RegExp(String.fromCharCode(0x2028), "g"), `${bs}u2028`)
    .replace(new RegExp(String.fromCharCode(0x2029), "g"), `${bs}u2029`);
  return `<div id="zk-root"></div><script type="application/json" id="zk-spec">${json}</script><script>ZeffKit.mount(document.getElementById("zk-root"), JSON.parse(document.getElementById("zk-spec").textContent));</script>`;
}
