import type { BlockDef } from "./blocks";
import { WIDGET_PRESETS } from "./widget-presets";

/**
 * The block library: ready-made blocks of your own (blocks.ts) that come with Zeff — each one click away in the Studio's Blocks
 * screen (or workspace_block_library for the assistant). They are made generic: the fields they work on are parameters (with the
 * usual names as defaults), so any database can use them. Installing one makes an ordinary block that is yours to change.
 */

export type LibraryBlock = BlockDef & { category: "figures" | "charts" | "lists" | "input" | "widgets" };

const text = (name: string, def: string, help = "") => ({ name, type: "text" as const, default: def, ...(help ? { help } : {}) });
const num = (name: string, def: string, help = "") => ({ name, type: "number" as const, default: def, ...(help ? { help } : {}) });

const calcWidget = `<style>
.k{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;max-width:300px}
.k button{padding:12px 0;font-size:18px;border:1px solid #d4d4d8;border-radius:8px;background:#f4f4f5;cursor:pointer}
.k button.op{background:#e0e7ff}.k button.eq{background:#6366f1;color:#fff}
#d{max-width:300px;box-sizing:border-box;width:100%;padding:10px;font-size:24px;text-align:right;border:1px solid #d4d4d8;border-radius:8px;margin-bottom:8px;background:transparent;color:inherit}
</style>
<input id="d" readonly value="0">
<div class="k" id="k"></div>
<script>
  const keys = ["7","8","9","/","4","5","6","*","1","2","3","-","0",".","=","+","C","(",")","⌫"];
  const d = document.getElementById("d");
  let expr = "";
  const show = () => { d.value = expr || "0"; };
  for (const k of keys) {
    const b = document.createElement("button");
    b.textContent = k;
    if ("/*-+".includes(k)) b.className = "op";
    if (k === "=") b.className = "eq";
    b.onclick = () => {
      if (k === "C") expr = "";
      else if (k === "⌫") expr = expr.slice(0, -1);
      else if (k === "=") {
        try {
          if (!/^[0-9+\\-*/().\\s]+$/.test(expr)) throw 0;
          expr = String(Function('"use strict";return (' + expr + ")")());
        } catch (e) { expr = "Error"; }
      } else expr = (expr === "Error" ? "" : expr) + k;
      show();
    };
    document.getElementById("k").appendChild(b);
  }
</script>`;

const converterWidget = `<style>
.r{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px}
input,select{padding:6px 8px;font:inherit;border:1px solid #d4d4d8;border-radius:6px;background:transparent;color:inherit}
</style>
<div class="r"><input id="v" type="number" value="1" style="width:110px"><select id="k"></select></div>
<div class="r"><b id="o"></b></div>
<script>
  const kinds = {
    Length: { m: 1, km: 1000, cm: 0.01, mm: 0.001, mi: 1609.344, yd: 0.9144, ft: 0.3048, in: 0.0254 },
    Weight: { kg: 1, g: 0.001, mg: 0.000001, t: 1000, lb: 0.45359237, oz: 0.028349523 },
    Volume: { l: 1, ml: 0.001, m3: 1000, gal: 3.785411784, cup: 0.2365882365 }
  };
  const all = Object.entries(kinds).flatMap(([k, u]) => Object.keys(u).map((x) => [k, x]));
  const sel = document.getElementById("k");
  for (const [k, x] of all) { const o = document.createElement("option"); o.value = k + ":" + x; o.textContent = x + " (" + k + ")"; sel.appendChild(o); }
  const draw = () => {
    const [k, u] = sel.value.split(":");
    const base = Number(document.getElementById("v").value) * kinds[k][u];
    document.getElementById("o").innerHTML = Object.entries(kinds[k]).filter(([x]) => x !== u).map(([x, f]) => (base / f).toLocaleString(undefined, { maximumFractionDigits: 4 }) + " " + x).join(" &nbsp;·&nbsp; ");
  };
  sel.onchange = draw; document.getElementById("v").oninput = draw; draw();
</script>`;

const timerWidget = `<style>
#t{font-size:44px;font-variant-numeric:tabular-nums;text-align:center;margin:4px 0}
.b{display:flex;gap:8px;justify-content:center}
button{padding:8px 16px;font:inherit;border:1px solid #d4d4d8;border-radius:8px;background:#f4f4f5;cursor:pointer}
button.p{background:#6366f1;color:#fff;border-color:#6366f1}
</style>
<div id="t">25:00</div>
<div class="b"><button class="p" id="go">Start</button><button id="rs">Reset</button><button id="m5">5 min</button><button id="m25">25 min</button></div>
<script>
  let left = (Number((zeff.context.params || {}).minutes) || 25) * 60, run = null, total = left;
  const t = document.getElementById("t"), go = document.getElementById("go");
  const draw = () => { t.textContent = String(Math.floor(left / 60)).padStart(2, "0") + ":" + String(left % 60).padStart(2, "0"); };
  const stop = () => { clearInterval(run); run = null; go.textContent = "Start"; };
  go.onclick = () => {
    if (run) return stop();
    go.textContent = "Pause";
    run = setInterval(() => { left = Math.max(0, left - 1); draw(); if (!left) { stop(); zeff.toast && zeff.toast("Time is up"); } }, 1000);
  };
  document.getElementById("rs").onclick = () => { stop(); left = total; draw(); };
  document.getElementById("m5").onclick = () => { stop(); left = total = 300; draw(); };
  document.getElementById("m25").onclick = () => { stop(); left = total = 1500; draw(); };
  draw();
</script>`;

const barsWidget = `<style>
.row{display:grid;grid-template-columns:130px 1fr 70px;gap:8px;align-items:center;margin:4px 0;font-size:14px}
.bar{height:16px;border-radius:4px;background:#6366f1;transition:width .3s}
.l{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.v{text-align:right;font-variant-numeric:tabular-nums}
</style>
<div id="o"></div>
<script>
  const p = zeff.context.params || {};
  const items = (p.values || []).map((r) => ({ name: String(r.title), v: Number(r[p.field]) || 0 })).filter((r) => r.v);
  items.sort((a, b) => b.v - a.v);
  const max = Math.max(1, ...items.map((i) => i.v));
  document.getElementById("o").innerHTML = items.length
    ? items.slice(0, 15).map((i) => '<div class="row"><span class="l" title="' + i.name.replace(/"/g, "") + '">' + i.name.replace(/</g, "&lt;") + '</span><div><div class="bar" style="width:' + (i.v / max * 100) + '%"></div></div><span class="v">' + i.v.toLocaleString() + "</span></div>").join("")
    : "<i>No numbers in the field “" + (p.field || "") + "”.</i>";
</script>`;

const BASE: LibraryBlock[] = [
  {
    category: "figures",
    name: "lib.stats",
    title: "Stats row",
    icon: "🔢",
    description: "Count, total, average and largest value of a number field as four tiles.",
    params: [text("field", "Amount", "The number field")],
    template: `<grid cols=4 gap=3 min=150><tile label="Rows" value="{{ rows | count }}"/><tile label="Total" value="{{ rows | sum(props.field) | number(0) }}"/><tile label="Average" value="{{ rows | avg(props.field) | number(1) }}"/><tile label="Largest" value="{{ rows | max(props.field) | number(0) }}"/></grid>`,
    example: `<use block="lib.stats" field="Amount"/>`,
  },
  {
    category: "figures",
    name: "lib.progress",
    title: "Progress bar",
    icon: "📶",
    description: "How many rows are done: a bar with the count.",
    params: [text("field", "Status", "The status field"), text("done", "Done", "The value that means done")],
    template: `<row><b>{{ rows | where(props.field, props.done) | count }}</b><muted>of {{ rows | count }} are {{ props.done }}</muted></row><bar value="{{ rows | where(props.field, props.done) | count }}" max="{{ rows | count }}" fill="#10b981"/>`,
    example: `<use block="lib.progress" field="Status" done="Done"/>`,
  },
  {
    category: "figures",
    name: "lib.goal-ring",
    title: "Goal ring",
    icon: "🎯",
    description: "A ring that fills toward a goal: the sum of a number field against it.",
    params: [text("field", "Amount"), num("goal", "1000", "The goal"), text("label", "Goal")],
    template: `<gauge value="{{ rows | sum(props.field) }}" max="{{ props.goal }}" label="{{ props.label }}" sub="{{ rows | sum(props.field) | number(0) }} / {{ props.goal }}"/>`,
    example: `<use block="lib.goal-ring" field="Amount" goal="5000" label="Revenue"/>`,
  },
  {
    category: "figures",
    name: "lib.summary",
    title: "Summary callout",
    icon: "💬",
    description: "One sentence on top: how many rows and their total, in a coloured box.",
    params: [text("field", "Amount"), text("title", "Summary"), { name: "tone", type: "text", default: "info", options: ["info", "good", "warn", "bad"] }],
    template: `<callout tone="{{ props.tone }}" title="{{ props.title }}">{{ rows | count }} rows · {{ rows | sum(props.field) | number(0) }} in {{ props.field }}</callout>`,
    example: `<use block="lib.summary" field="Amount" title="This quarter" tone="good"/>`,
  },
  {
    category: "figures",
    name: "lib.copy",
    title: "Copy button",
    icon: "📋",
    description: "A button that copies a text to the clipboard.",
    params: [text("text", "", "What to copy"), text("label", "Copy")],
    template: `<copy text="{{ props.text }}" label="{{ props.label }}"/>`,
    example: `<use block="lib.copy" text="https://example.org" label="Copy link"/>`,
  },
  {
    category: "charts",
    name: "lib.by-group",
    title: "Chart by group",
    icon: "📊",
    description: "A bar, column, line or pie chart of the rows grouped by a field.",
    params: [
      text("group", "Status", "Group by this field"),
      text("value", "Amount", "The number field to add up"),
      { name: "kind", type: "text", default: "column", options: ["column", "bar", "line", "pie"] },
      { name: "calc", type: "text", default: "sum", options: ["sum", "count", "avg"] },
    ],
    template: `<chart kind="{{ props.kind }}" source="rows" group="{{ props.group }}" value="{{ props.value }}" calc="{{ props.calc }}"/>`,
    example: `<use block="lib.by-group" group="Owner" value="Amount" kind="pie"/>`,
  },
  {
    category: "charts",
    name: "lib.pivot",
    title: "Cross table",
    icon: "🧮",
    description: "Owners by status (or any two fields) with totals — a pivot table.",
    params: [text("down", "Owner", "Rows of the table"), text("across", "Status", "Columns of the table"), text("value", "Amount"), { name: "calc", type: "text", default: "sum", options: ["sum", "count", "avg"] }],
    template: `<pivot source="rows" rows="{{ props.down }}" cols="{{ props.across }}" value="{{ props.value }}" calc="{{ props.calc }}" total=true/>`,
    example: `<use block="lib.pivot" down="Owner" across="Status" value="Amount"/>`,
  },
  {
    category: "charts",
    name: "lib.heatmap",
    title: "Activity heatmap",
    icon: "🟩",
    description: "A day-by-day grid of the last half year: darker where more rows fall on a day.",
    params: [text("date", "Due", "The date field"), text("label", "Activity")],
    template: `<heatmap source="rows" date="{{ props.date }}" calc="count" weeks=26 label="{{ props.label }}"/>`,
    example: `<use block="lib.heatmap" date="Due"/>`,
  },
  {
    category: "charts",
    name: "lib.calendar",
    title: "Month calendar",
    icon: "🗓️",
    description: "The rows on their days of a month, paged with ‹ ›.",
    params: [text("date", "Due", "The date field")],
    template: `<calendar source="rows" date="{{ props.date }}" empty="Nothing this month"><b>{{ title }}</b></calendar>`,
    example: `<use block="lib.calendar" date="Due"/>`,
  },
  {
    category: "lists",
    name: "lib.timeline",
    title: "Latest as timeline",
    icon: "🕑",
    description: "The newest rows on a timeline, by a date field.",
    params: [text("date", "Due", "The date field"), num("n", "10", "How many")],
    template: `<timeline source="rows | sort(props.date, 'desc') | limit(props.n)" date="{{ props.date | field | date }}" empty="Nothing yet"><b>{{ title }}</b></timeline>`,
    example: `<use block="lib.timeline" date="Due" n="8"/>`,
  },
  {
    category: "lists",
    name: "lib.board",
    title: "Board by group",
    icon: "🗂️",
    description: "Columns by a select field; a dragged card takes the column's value.",
    params: [text("group", "Status", "The select or status field")],
    template: `<board source="rows" group="{{ props.group }}" none="No {{ props.group }}"><b>{{ title }}</b></board>`,
    example: `<use block="lib.board" group="Status"/>`,
  },
  {
    category: "lists",
    name: "lib.cards",
    title: "Cards",
    icon: "🃏",
    description: "Rows as cards with a second line from another field.",
    params: [text("sub", "Status", "The field shown under the title"), num("cols", "3"), num("n", "12", "How many")],
    template: `<cards source="rows | limit(props.n)" cols="{{ props.cols }}"><b>{{ title }}</b><muted>{{ props.sub | field }}</muted></cards>`,
    example: `<use block="lib.cards" sub="Owner" cols="4"/>`,
  },
  {
    category: "lists",
    name: "lib.filter-list",
    title: "Searchable list with filters",
    icon: "🔎",
    description: "A search box and filter pills over a list of the rows.",
    params: [text("field", "Status", "The field to filter by")],
    template: `<state name="q" value=""/><state name="s" value=""/><toolbar><search bind="q" placeholder="Search"/><facets bind="s" field="{{ props.field }}" all="All"/></toolbar><list source="rows | search(state.q) | only(props.field, state.s)" empty="No match"><row><b>{{ title }}</b><grow/>{{ props.field | field | chip }}</row></list>`,
    example: `<use block="lib.filter-list" field="Status"/>`,
  },
  {
    category: "lists",
    name: "lib.open-done",
    title: "Open / Done tabs",
    icon: "✅",
    description: "Two tabs with counts: what is still open and what is done.",
    params: [text("field", "Status"), text("done", "Done")],
    template: `<let name="open" value="rows | where(props.field, '!=', props.done)"/><let name="closed" value="rows | where(props.field, props.done)"/><tabset bind="t"><tab id="open" label="Open" n="{{ open | count }}"><list source="open" empty="Nothing open"><row><b>{{ title }}</b></row></list></tab><tab id="done" label="Done" n="{{ closed | count }}"><list source="closed" empty="Nothing done yet"><row><strike>{{ title }}</strike></row></list></tab></tabset>`,
    example: `<use block="lib.open-done" field="Status" done="Done"/>`,
  },
  {
    category: "lists",
    name: "lib.rank",
    title: "Ranking with stars",
    icon: "⭐",
    description: "Rows sorted by a number field, with stars you click to rate.",
    params: [text("field", "Stars", "A number field (0–5)")],
    template: `<list source="rows | sort(props.field, 'desc')" empty="No rows"><row><b>{{ title }}</b><grow/><rating prop="{{ props.field }}"/></row></list>`,
    example: `<use block="lib.rank" field="Stars"/>`,
  },
  {
    category: "input",
    name: "lib.quick-add",
    title: "Quick add line",
    icon: "➕",
    description: "A line: type a title, press Enter, a row is added.",
    params: [text("placeholder", "Add …"), text("values", "", "Values to start with, e.g. Status=Open")],
    template: `<quickadd placeholder="{{ props.placeholder }}" values="{{ props.values }}"/>`,
    example: `<use block="lib.quick-add" placeholder="New deal …" values="Status=Open"/>`,
  },
  {
    category: "input",
    name: "lib.threshold",
    title: "Amount filter with slider",
    icon: "🎚️",
    description: "A slider that hides rows below a value; the list shows what is left.",
    params: [text("field", "Amount"), num("max", "1000")],
    template: `<slider bind="min" min=0 max="{{ props.max }}" step=10 label="At least" value="0"/><list source="rows | where(props.field, '>=', state.min) | sort(props.field, 'desc')" empty="Nothing that high"><row><b>{{ title }}</b><grow/>{{ props.field | field | number(0) }}</row></list>`,
    example: `<use block="lib.threshold" field="Amount" max="5000"/>`,
  },
  {
    category: "widgets",
    name: "lib.calculator",
    title: "Calculator",
    icon: "🧮",
    description: "A pocket calculator (a widget).",
    params: [],
    template: "",
    widget: { html: calcWidget, libs: [], writes: [], ai: false, flows: [], height: 380 },
    example: `<use block="lib.calculator"/>`,
  },
  {
    category: "widgets",
    name: "lib.converter",
    title: "Unit converter",
    icon: "📏",
    description: "Length, weight and volume converted into all other units (a widget).",
    params: [],
    template: "",
    widget: { html: converterWidget, libs: [], writes: [], ai: false, flows: [], height: 160 },
    example: `<use block="lib.converter"/>`,
  },
  {
    category: "widgets",
    name: "lib.timer",
    title: "Timer",
    icon: "⏱️",
    description: "A countdown (25 or 5 minutes, or the minutes you give) with start, pause and reset (a widget).",
    params: [num("minutes", "25", "Starting minutes")],
    template: "",
    widget: { html: timerWidget, libs: [], writes: [], ai: false, flows: [], height: 190 },
    example: `<use block="lib.timer" minutes="50"/>`,
  },
  {
    category: "widgets",
    name: "lib.bars",
    title: "Bar chart of rows",
    icon: "📶",
    description: "Horizontal bars of a number field per row (a widget fed with the rows).",
    params: [{ name: "values", type: "list", required: true }, text("field", "Amount", "The number field")],
    template: "",
    widget: { html: barsWidget, libs: [], writes: [], ai: false, flows: [], height: 320 },
    example: `<use block="lib.bars" values="rows" field="Amount"/>`,
  },
];

export const LIBRARY: LibraryBlock[] = [...BASE, ...WIDGET_PRESETS];

export const CATEGORIES: LibraryBlock["category"][] = ["figures", "charts", "lists", "input", "widgets"];

export function libraryBlock(name: string): LibraryBlock | undefined {
  return LIBRARY.find((b) => b.name === name.trim().toLowerCase());
}
