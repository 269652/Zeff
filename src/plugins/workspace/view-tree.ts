import type { FilterCall, TNode } from "./card-template";
import { parseView, VIEW_TAGS } from "./view-template";

/**
 * A view template as a tree the visual builder edits: parsed (view-template's parser), changed by paths (a node's place: the indexes
 * down to it; an if's else and an each's body are branches of their own), and written back as tidy template text — a block element
 * on a line of its own, indented, what is inline (text, values, <b>) kept on its line. And the kit: the elements the builder offers,
 * each with what it starts with. Pure and client-safe.
 */

export type Path = number[];
/** Where children go: a tag's kids, an if's then or else, an each's body. */
export type Branch = "kids" | "then" | "else" | "body";
export type Slot = { parent: Path | null; branch: Branch };

export const kidsOf = (n: TNode, branch: Branch): TNode[] | null => (n.k === "tag" && branch === "kids" ? n.kids : n.k === "if" && (branch === "then" || branch === "else") ? n[branch] : n.k === "each" && branch === "body" ? n.body : null);
export const branchesOf = (n: TNode): Branch[] => (n.k === "tag" ? (VIEW_TAGS[n.name]?.void ? [] : ["kids"]) : n.k === "if" ? ["then", "else"] : n.k === "each" ? ["body"] : []);

/** A node's place is (path, branch at each step): [2, "kids", 0] — kept simple: a path step into an if's else is written as 1000+i. */
const ELSE = 1000;

export function nodeAt(nodes: TNode[], path: Path): TNode | null {
  let node: TNode | null = null;
  for (const step of path) {
    const inElse = step >= ELSE;
    const list: TNode[] = !node ? nodes : node.k === "tag" ? node.kids : node.k === "each" ? node.body : node.k === "if" ? (inElse ? node.else : node.then) : [];
    node = list[inElse ? step - ELSE : step] ?? null;
    if (!node) return null;
  }
  return node;
}

/** The list a slot is. */
function listOf(nodes: TNode[], slot: Slot): TNode[] | null {
  if (!slot.parent) return nodes;
  const p = nodeAt(nodes, slot.parent);
  return p ? kidsOf(p, slot.branch) : null;
}

/** The list and index a node at a path sits in. */
function placeOf(nodes: TNode[], path: Path): { list: TNode[]; index: number } | null {
  if (!path.length) return null;
  const parentPath = path.slice(0, -1);
  const last = path[path.length - 1];
  const parent = parentPath.length ? nodeAt(nodes, parentPath) : null;
  if (parentPath.length && !parent) return null;
  const inElse = last >= ELSE;
  const list = parent ? (parent.k === "tag" ? parent.kids : parent.k === "each" ? parent.body : parent.k === "if" ? (inElse ? parent.else : parent.then) : null) : nodes;
  return list ? { list, index: inElse ? last - ELSE : last } : null;
}

const clone = (nodes: TNode[]): TNode[] => structuredClone(nodes);

/** The slot a node at a path sits in, and its index there. */
export function slotOfPath(nodes: TNode[], path: Path): { slot: Slot; index: number } {
  const parentPath = path.slice(0, -1);
  const last = path[path.length - 1] ?? 0;
  const parent = parentPath.length ? nodeAt(nodes, parentPath) : null;
  const branch: Branch = !parent || parent.k === "tag" ? "kids" : parent.k === "each" ? "body" : last >= ELSE ? "else" : "then";
  return { slot: { parent: parentPath.length ? parentPath : null, branch }, index: last >= ELSE ? last - ELSE : last };
}

/** The path of the i-th child in a slot. */
export const childPath = (slot: Slot, i: number): Path => [...(slot.parent ?? []), slot.branch === "else" ? ELSE + i : i];

export function insertAt(nodes: TNode[], slot: Slot, index: number, node: TNode): TNode[] {
  const out = clone(nodes);
  const list = listOf(out, slot);
  if (list) list.splice(Math.max(0, Math.min(list.length, index)), 0, node);
  return out;
}

export function removeAt(nodes: TNode[], path: Path): { nodes: TNode[]; removed: TNode | null } {
  const out = clone(nodes);
  const p = placeOf(out, path);
  if (!p) return { nodes: out, removed: null };
  const [removed] = p.list.splice(p.index, 1);
  return { nodes: out, removed: removed ?? null };
}

/** A node moved into a slot (its index counted before it was taken out); not into itself. */
export function moveTo(nodes: TNode[], from: Path, slot: Slot, index: number): TNode[] {
  if (slot.parent && from.length <= slot.parent.length && from.every((s, i) => slot.parent![i] === s)) return nodes;
  const fromPlace = placeOf(nodes, from);
  const target = listOf(nodes, slot);
  if (!fromPlace || !target) return nodes;
  const sameList = fromPlace.list === target;
  const { nodes: without, removed } = removeAt(nodes, from);
  if (!removed) return nodes;
  // (Taken out before the target's container in the same list: that container moved up one.)
  let parent = slot.parent;
  const level = from.length - 1;
  if (parent && parent.length > level && from.slice(0, level).every((x, i) => parent![i] === x) && (parent[level] >= ELSE) === (from[level] >= ELSE) && parent[level] > from[level]) parent = parent.map((x, i) => (i === level ? x - 1 : x));
  return insertAt(without, { ...slot, parent }, sameList && fromPlace.index < index ? index - 1 : index, removed);
}

export function updateAt(nodes: TNode[], path: Path, patch: (n: TNode) => TNode): TNode[] {
  const out = clone(nodes);
  const p = placeOf(out, path);
  if (p) p.list[p.index] = patch(p.list[p.index]);
  return out;
}

// ---------------------------------------------------------------------------
// Back to text
// ---------------------------------------------------------------------------

/** What stands inline: text, a value, the text tags. */
const INLINE = new Set(["b", "i", "small", "muted", "code", "mono", "truncate", "strike", "chip", "badge", "a", "dot", "bar", "img", "avatar", "logo", "todomark", "field", "grow", "clamp"]);
const isInline = (n: TNode) => n.k === "text" || n.k === "out" || (n.k === "tag" && INLINE.has(n.name));

const quoteAttr = (v: string) => (v.includes('"') ? `'${v}'` : `"${v}"`);
const filterText = (f: FilterCall) => (f.args.length ? `${f.name}(${f.args.map((a, i) => (typeof a === "number" ? String(a) : f.names?.[i] ? a : `'${String(a).replace(/'/g, "\\'")}'`)).join(", ")})` : f.name);
const outText = (n: Extract<TNode, { k: "out" }>) => `{{ ${[n.expr, ...n.filters.map(filterText)].join(" | ")} }}`;

function inline(n: TNode): string {
  if (n.k === "text") return n.v;
  if (n.k === "out") return outText(n);
  if (n.k === "if") return `{{#if ${n.cond}}}${n.then.map(inline).join("")}${n.else.length ? `{{#else}}${n.else.map(inline).join("")}` : ""}{{/if}}`;
  if (n.k === "each") return `{{#each ${n.expr}}}${n.body.map(inline).join("")}{{/each}}`;
  const attrs = n.attrs.map(([k, v]) => ` ${k}=${quoteAttr(v)}`).join("");
  if (VIEW_TAGS[n.name]?.void) return `<${n.name}${attrs}/>`;
  return `<${n.name}${attrs}>${n.kids.map(inline).join("")}</${n.name}>`;
}

/** The tree as template text: blocks on their own lines, indented by two spaces a level; what is inline stays on one line. */
export function treeToTemplate(nodes: TNode[], depth = 0): string {
  const pad = "  ".repeat(depth);
  const lines: string[] = [];
  let run = "";
  const flush = () => {
    if (run.trim()) lines.push(pad + run.trim());
    run = "";
  };
  for (const n of nodes) {
    if (isInline(n) || (n.k === "if" && [...n.then, ...n.else].every(isInline)) || (n.k === "each" && n.body.every(isInline))) {
      run += inline(n);
      continue;
    }
    flush();
    if (n.k === "if") {
      lines.push(`${pad}{{#if ${n.cond}}}`, treeToTemplate(n.then, depth + 1), ...(n.else.length ? [`${pad}{{#else}}`, treeToTemplate(n.else, depth + 1)] : []), `${pad}{{/if}}`);
    } else if (n.k === "each") {
      lines.push(`${pad}{{#each ${n.expr}}}`, treeToTemplate(n.body, depth + 1), `${pad}{{/each}}`);
    } else if (n.k === "tag") {
      const attrs = n.attrs.map(([k, v]) => ` ${k}=${quoteAttr(v)}`).join("");
      if (VIEW_TAGS[n.name]?.void) lines.push(`${pad}<${n.name}${attrs}/>`);
      else if (n.kids.every(isInline)) lines.push(`${pad}<${n.name}${attrs}>${n.kids.map(inline).join("").trim()}</${n.name}>`);
      else lines.push(`${pad}<${n.name}${attrs}>`, treeToTemplate(n.kids, depth + 1), `${pad}</${n.name}>`);
    }
  }
  flush();
  return lines.filter((l) => l.trim()).join("\n");
}

/** A template read for the builder (errors: it can't be built visually until they are fixed in the code). */
export const templateToTree = (src: string): { nodes: TNode[]; errors: { line: number; message: string }[] } => {
  const p = parseView(src);
  return { nodes: structuredClone(p.nodes), errors: p.errors };
};

// ---------------------------------------------------------------------------
// The kit
// ---------------------------------------------------------------------------

export type KitItem = { id: string; group: "Layout" | "Data" | "Input" | "Text" | "Flows" | "Logic"; label: string; icon: string; what: string; template: string };

/** The elements the builder offers: each a piece of template it starts as. */
export const KIT: KitItem[] = [
  { id: "header", group: "Layout", label: "Header", icon: "🏷️", what: "The view's top: title, subtitle, buttons", template: '<header title="{{ db.title }}" subtitle=""><button action="new" label="New" variant=primary/></header>' },
  { id: "toolbar", group: "Layout", label: "Toolbar", icon: "🧰", what: "A line of search, filters, buttons", template: '<toolbar><search bind="q" placeholder="Search"/><grow/></toolbar>' },
  { id: "row", group: "Layout", label: "Row", icon: "↔️", what: "Side by side", template: "<row gap=2>Text</row>" },
  { id: "col", group: "Layout", label: "Column", icon: "↕️", what: "One under the other", template: "<col gap=2>Text</col>" },
  { id: "grid", group: "Layout", label: "Grid", icon: "▦", what: "Columns that wrap", template: '<grid cols=3><tile label="Rows" value="{{ rows | count }}"/></grid>' },
  { id: "split", group: "Layout", label: "Split", icon: "◫", what: "A list, the row picked beside it", template: '<split side=right width=360><list source="rows" select=true><b>{{ title }}</b></list><selected empty="Pick one"><header title="{{ title }}"/></selected></split>' },
  { id: "panes", group: "Layout", label: "Panes", icon: "▥", what: "Columns as high as the window", template: '<panes><pane title="List" width=320><list source="rows" select=true><b>{{ title }}</b></list></pane><pane title="Details"><selected empty="Pick one"><header title="{{ title }}"/></selected></pane></panes>' },
  { id: "section", group: "Layout", label: "Section", icon: "📑", what: "A titled part, foldable", template: '<section title="Section" collapsible=true>Text</section>' },
  { id: "box", group: "Layout", label: "Box", icon: "▢", what: "A framed part", template: '<box title="Box">Text</box>' },
  { id: "divider", group: "Layout", label: "Divider", icon: "➖", what: "A line with a label", template: '<divider label="More"/>' },
  { id: "list", group: "Data", label: "List", icon: "📋", what: "The rows as a list", template: '<list source="rows | search(state.q)" open=true empty="Nothing yet"><row wrap=false><col fill=true><b>{{ title }}</b></col></row></list>' },
  { id: "cards", group: "Data", label: "Cards", icon: "🃏", what: "The rows as cards", template: '<cards source="rows" cols=3><b>{{ title }}</b></cards>' },
  { id: "gallery", group: "Data", label: "Gallery", icon: "🖼️", what: "Pictures of the rows", template: '<gallery source="rows" image="{{ title }}" ratio=2:3><b>{{ title }}</b></gallery>' },
  { id: "table", group: "Data", label: "Table", icon: "▤", what: "The rows as a table", template: '<table source="rows" columns="title"/>' },
  { id: "timeline", group: "Data", label: "Timeline", icon: "🕑", what: "The rows by a date", template: "<timeline source=\"rows\" date=\"{{ title }}\"><b>{{ title }}</b></timeline>" },
  { id: "board", group: "Data", label: "Board", icon: "🗂️", what: "Columns by a status", template: '<board source="rows" group="Status"><b>{{ title }}</b></board>' },
  { id: "chart", group: "Data", label: "Chart", icon: "📊", what: "Counted or summed by a field", template: '<chart kind=bar source="rows" group="Status" calc=count/>' },
  { id: "tile", group: "Data", label: "Tile", icon: "🔢", what: "A figure", template: '<tile label="Rows" value="{{ rows | count }}"/>' },
  { id: "selected", group: "Data", label: "Row picked", icon: "👉", what: "The row a list picked", template: '<selected empty="Pick one"><header title="{{ title }}"/></selected>' },
  { id: "field", group: "Data", label: "Field", icon: "🔤", what: "A row's property, editable", template: '<field name="Status"/>' },
  { id: "search", group: "Input", label: "Search", icon: "🔍", what: "Typed into state.q", template: '<search bind="q" placeholder="Search"/>' },
  { id: "tabs", group: "Input", label: "Tabs", icon: "🗂", what: "Picks a state", template: '<tabs bind="tab" options="a:A, b:B"/>' },
  { id: "select", group: "Input", label: "Select", icon: "🔽", what: "Picks a state from options", template: '<select bind="s" options="a:A, b:B" label="Pick"/>' },
  { id: "toggle", group: "Input", label: "Toggle", icon: "🔘", what: "Turns a state on and off", template: '<toggle bind="done" label="Done too"/>' },
  { id: "quickadd", group: "Input", label: "Quick add", icon: "➕", what: "A line that adds a row", template: '<quickadd placeholder="New …"/>' },
  { id: "form", group: "Input", label: "Form", icon: "📝", what: "Several fields at once", template: '<form fields="title" label="Add"/>' },
  { id: "lookup", group: "Input", label: "Lookup", icon: "🔎", what: "Searches a source, adds a row", template: '<lookup source="wikipedia" placeholder="Look up …" map="title=title"/>' },
  { id: "button", group: "Input", label: "Button", icon: "🔲", what: "An action", template: '<button action="new" label="New"/>' },
  { id: "heading", group: "Text", label: "Heading", icon: "🔠", what: "A title", template: "<heading level=2>Title</heading>" },
  { id: "text", group: "Text", label: "Text", icon: "¶", what: "A paragraph", template: "<text>Text</text>" },
  { id: "value", group: "Text", label: "Value", icon: "{}", what: "A value: {{ … }}", template: "{{ title }}" },
  { id: "callout", group: "Text", label: "Callout", icon: "💬", what: "A note that stands out", template: '<callout tone=info title="Note">Text</callout>' },
  { id: "empty", group: "Text", label: "Empty state", icon: "📭", what: "What to do when there is nothing", template: '<empty icon="📭" title="Nothing here" text="Add the first one."/>' },
  { id: "img", group: "Text", label: "Picture", icon: "🖼", what: "An image", template: '<img src="https://" h=120/>' },
  { id: "data", group: "Flows", label: "Flow data", icon: "⚡", what: "A flow's output in data.<name>", template: '<data name="result" flow="my.flow" with="q={{ state.q }}"/>' },
  { id: "run", group: "Flows", label: "Flow button", icon: "▶️", what: "Runs a flow", template: '<button run="my.flow" label="Run" into="result"/>' },
  { id: "transitions", group: "Flows", label: "Transitions", icon: "⟳", what: "A row's lifecycle buttons", template: "<transitions history=true/>" },
  { id: "if", group: "Logic", label: "If", icon: "❓", what: "Shown only when …", template: "{{#if state.q}}Text{{/if}}" },
  { id: "each", group: "Logic", label: "For each", icon: "🔁", what: "Repeated per item", template: "{{#each rows | limit(5)}}<b>{{ title }}</b>{{/each}}" },
  { id: "state", group: "Logic", label: "State", icon: "💾", what: "A value the view keeps", template: '<state name="q" value=""/>' },
];

/** A kit element as nodes to put in. */
export const kitNodes = (item: KitItem): TNode[] => templateToTree(item.template).nodes;
