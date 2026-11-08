import type { FlowDef, FlowNode, FlowNodeKind } from "@/plugins/workspace/flows/types";

/**
 * A flow's nodes edited as a tree (the Studio's canvas): where a node is, one changed, inserted, moved or removed, and what a node
 * can read (the paths before it: the inputs, the steps that ran before, a loop's item, the vars). Pure and client-safe.
 */

/** A place for nodes: the top list, or a branch of a node ("then", "else", "nodes", "catch", "default", "case:0", "branch:1"). */
export type Slot = { parent: string | null; branch: string };

const kids = (n: FlowNode): [string, FlowNode[]][] => {
  switch (n.kind) {
    case "if":
      return [["then", n.then], ["else", n.else]];
    case "switch":
      return [...n.cases.map((c, i): [string, FlowNode[]] => [`case:${i}`, c.nodes]), ["default", n.default]];
    case "foreach":
      return [["nodes", n.nodes]];
    case "try":
      return [["nodes", n.nodes], ["catch", n.catch]];
    case "parallel":
      return n.branches.map((b, i): [string, FlowNode[]] => [`branch:${i}`, b]);
    default:
      return [];
  }
};

/** The list a slot is (null: no such slot). */
function listAt(nodes: FlowNode[], slot: Slot): FlowNode[] | null {
  if (slot.parent === null) return nodes;
  const p = findNode(nodes, slot.parent);
  return p ? (kids(p).find(([b]) => b === slot.branch)?.[1] ?? null) : null;
}

export function findNode(nodes: FlowNode[], id: string): FlowNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    for (const [, list] of kids(n)) {
      const hit = findNode(list, id);
      if (hit) return hit;
    }
  }
  return null;
}

/** Every node's slot and index. */
export function slotOf(nodes: FlowNode[], id: string, parent: string | null = null, branch = "root"): { slot: Slot; index: number } | null {
  const i = nodes.findIndex((n) => n.id === id);
  if (i >= 0) return { slot: { parent, branch }, index: i };
  for (const n of nodes)
    for (const [b, list] of kids(n)) {
      const hit = slotOf(list, id, n.id, b);
      if (hit) return hit;
    }
  return null;
}

const clone = (nodes: FlowNode[]): FlowNode[] => structuredClone(nodes);

/** A node changed (its fields merged; its id stays). */
export function updateNode(nodes: FlowNode[], id: string, patch: Partial<FlowNode>): FlowNode[] {
  const out = clone(nodes);
  const n = findNode(out, id);
  if (n) Object.assign(n, patch, { id: n.id });
  return out;
}

export function insertNode(nodes: FlowNode[], slot: Slot, index: number, node: FlowNode): FlowNode[] {
  const out = clone(nodes);
  const list = listAt(out, slot);
  if (!list) return out;
  list.splice(Math.max(0, Math.min(list.length, index)), 0, node);
  return out;
}

export function removeNode(nodes: FlowNode[], id: string): FlowNode[] {
  const out = clone(nodes);
  const at = slotOf(out, id);
  if (!at) return out;
  listAt(out, at.slot)!.splice(at.index, 1);
  return out;
}

/** A node one up or down among its siblings. */
export function moveNode(nodes: FlowNode[], id: string, by: -1 | 1): FlowNode[] {
  const out = clone(nodes);
  const at = slotOf(out, id);
  if (!at) return out;
  const list = listAt(out, at.slot)!;
  const to = at.index + by;
  if (to < 0 || to >= list.length) return out;
  [list[at.index], list[to]] = [list[to], list[at.index]];
  return out;
}

/** A free id for a new node of this kind ("fetch", "fetch2" …). */
export function freeId(nodes: FlowNode[], base: string): string {
  const taken = new Set<string>();
  const walk = (list: FlowNode[]) => list.forEach((n) => (taken.add(n.id), kids(n).forEach(([, l]) => walk(l))));
  walk(nodes);
  const b = base.replace(/[^\w-]/g, "_").replace(/^(\d)/, "n$1") || "n";
  if (!taken.has(b)) return b;
  for (let i = 2; ; i++) if (!taken.has(`${b}${i}`)) return `${b}${i}`;
}

/** A fresh node of a kind (an action node with its action). */
export function newNode(nodes: FlowNode[], kind: FlowNodeKind, action?: string): FlowNode {
  const id = freeId(nodes, action ? (action.split(".").pop() ?? kind) : kind);
  switch (kind) {
    case "action":
      return { id, kind, action: action ?? "http.request", input: {} };
    case "set":
      return { id, kind, vars: {} };
    case "if":
      return { id, kind, when: "", then: [], else: [] };
    case "switch":
      return { id, kind, on: "", cases: [{ value: "", nodes: [] }], default: [] };
    case "foreach":
      return { id, kind, items: "", nodes: [] };
    case "parallel":
      return { id, kind, branches: [[], []] };
    case "try":
      return { id, kind, nodes: [], catch: [] };
    case "script":
      return { id, kind, code: "// input, steps, vars, item, row are there as data\nreturn input;", input: {} };
    case "ask":
      return { id, kind, title: "How are you, from 1 to 10?", fields: [{ name: "value", kind: "scale", min: 1, max: 10, required: true }, { name: "note", kind: "text" }], expiresMinutes: 55 };
    case "approve":
      return { id, kind, title: "Go on?", options: ["yes", "no"] };
    case "wait":
      return { id, kind, minutes: 60 };
    case "call":
      return { id, kind, flow: "", input: {} };
    case "return":
      return { id, kind, value: "" };
    case "fail":
      return { id, kind, message: "" };
  }
}

/** What a node can read: the flow's inputs, the steps that come before it (and the ones it is inside), a loop's item, vars, secrets. */
export function pathsBefore(def: Pick<FlowDef, "inputs" | "nodes">, id: string, secrets: string[] = []): { path: string; what: string }[] {
  const out: { path: string; what: string }[] = def.inputs.map((f) => ({ path: `input.${f.name}`, what: f.label || f.type }));
  const walk = (list: FlowNode[], inside: string[]): boolean => {
    for (const n of list) {
      if (n.id === id) return true;
      for (const [, l] of kids(n)) if (walk(l, [...inside, n.id])) {
        if (n.kind === "foreach") out.push({ path: n.as ? n.as : "item", what: `an item of ${n.id}` }, { path: "index", what: "the item's number" });
        if (n.kind === "try") out.push({ path: "error.message", what: "the error caught" });
        return true;
      }
      out.push({ path: `steps.${n.id}`, what: n.kind === "action" ? n.action : n.kind });
    }
    return false;
  };
  walk(def.nodes, []);
  return [...out, { path: "vars", what: "what set nodes set" }, { path: "row", what: "the row (a button in a row, an event)" }, { path: "env.today", what: "today" }, ...secrets.map((s) => ({ path: `secrets.${s}`, what: "a secret" }))];
}

/** A node's line on the canvas: what it does in a few words. */
export function nodeSummary(n: FlowNode): string {
  switch (n.kind) {
    case "action":
      return n.action;
    case "set":
      return Object.keys(n.vars).map((k) => `vars.${k}`).join(", ") || "—";
    case "if":
      return n.when || "(no condition)";
    case "switch":
      return n.on || "(nothing to switch on)";
    case "foreach":
      return `each of ${n.items || "…"}`;
    case "parallel":
      return `${n.branches.length} branches`;
    case "try":
      return "on error: catch";
    case "script":
      return `${n.code.split("\n").filter((l) => l.trim() && !l.trim().startsWith("//")).length} lines of JavaScript`;
    case "ask":
      return `${n.title} (${n.fields.map((f) => f.name).join(", ")})`;
    case "approve":
      return n.title;
    case "wait":
      return n.until ? `until ${n.until}` : `${n.minutes ?? 1} min`;
    case "call":
      return n.flow || "(which flow?)";
    case "return":
      return typeof n.value === "string" ? n.value || "—" : "an object";
    case "fail":
      return n.message;
  }
}

export const BRANCH_LABEL = (branch: string): string => (branch.startsWith("case:") ? `case ${Number(branch.slice(5)) + 1}` : branch.startsWith("branch:") ? `branch ${Number(branch.slice(7)) + 1}` : branch);

export { kids as nodeBranches };
