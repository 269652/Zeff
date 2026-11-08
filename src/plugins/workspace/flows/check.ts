import { flowAction } from "./actions";
import { checkExpr } from "./expr";
import { flowByName } from "./store";
import { walkNodes, type FlowDef } from "./types";

/**
 * A flow checked before it is saved (the AI's, the Studio's): the actions it calls exist and get what they must, its expressions
 * read, the flows it calls are there, its node ids unique. The problems in words — none: it can run. Server only.
 */
export function checkFlow(def: FlowDef): string[] {
  const out: string[] = [];
  const ids = new Set<string>();
  const exprsIn = (v: unknown, where: string) => {
    if (typeof v === "string") for (const m of v.matchAll(/\{\{([\s\S]*?)\}\}/g)) {
      const bad = checkExpr(m[1]);
      if (bad) out.push(`${where}: {{${m[1]}}} — ${bad}`);
    }
    else if (Array.isArray(v)) v.forEach((x) => exprsIn(x, where));
    else if (v && typeof v === "object") Object.values(v).forEach((x) => exprsIn(x, where));
  };
  walkNodes(def.nodes, (n) => {
    const where = n.label ? `${n.id} (${n.label})` : n.id;
    if (ids.has(n.id)) out.push(`${where}: the id is used twice`);
    ids.add(n.id);
    if (n.kind === "action") {
      const a = flowAction(n.action);
      if (!a) out.push(`${where}: there is no action “${n.action}” (workspace_flow_docs lists them)`);
      else for (const f of a.input) if (f.required && (n.input[f.name] === undefined || n.input[f.name] === "")) out.push(`${where}: ${n.action} needs “${f.name}”`);
      exprsIn(n.input, where);
    } else if (n.kind === "call") {
      if (n.flow !== def.name && !flowByName(n.flow)) out.push(`${where}: there is no flow “${n.flow}”`);
      exprsIn(n.input, where);
    } else if (n.kind === "if") exprsIn(`{{${n.when}}}`, where);
    else if (n.kind === "switch") exprsIn(`{{${n.on}}}`, where);
    else if (n.kind === "foreach") exprsIn(`{{${n.items.replace(/^\{\{([\s\S]*)\}\}$/, "$1")}}}`, where);
    else if (n.kind === "set") exprsIn(n.vars, where);
    else if (n.kind === "script") exprsIn(n.input ?? {}, where);
    else if (n.kind === "return") exprsIn(n.value, where);
  });
  if (def.output !== undefined) exprsIn(def.output, "output");
  return out.slice(0, 30);
}
