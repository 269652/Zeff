/**
 * Blocks of your own (the Workspace plugin): a building block of the view language made from the language itself — what it takes
 * (its parameters), how it looks (a template in the view language) and what it does on the server (its own flows, named
 * block.<name>.<flow>, reached from its template as run="@flow" / flow="@flow"). Any view uses it as <use block="name" …/>; you or
 * the AI make one (workspace_save_block). Its template stays as harmless as any view's: no script, no HTML — what it does on the
 * server is a flow, with the flow's permissions. Client-safe.
 */

export const BLOCK_PARAM_TYPES = ["text", "number", "boolean", "list", "color", "url"] as const;
export type BlockParamType = (typeof BLOCK_PARAM_TYPES)[number];

/**
 * A parameter: an attribute of <use>. `list`: a collection, written as a filter chain (items="rows | where('Status', 'Open')"),
 * evaluated where the block is used; the others are texts with {{ … }} in them, made a number or true/false by their type.
 */
export type BlockParam = { name: string; type: BlockParamType; required?: boolean; default?: string; help?: string; options?: string[] };

export type BlockDef = {
  name: string;
  title?: string;
  description: string;
  icon?: string;
  params: BlockParam[];
  /** The view language: {{ props.<param> }}, <slot/> (what stood inside <use>), state of its own per use. */
  template: string;
  /** How it is used — an example <use …/> the help and the AI show. */
  example?: string;
  updatedAt?: string;
};

export const MAX_BLOCK_TEMPLATE = 20000;
/** A block's name: lowercase letters, digits, - and _, parts joined by dots ("crm.deal-card"). */
export const BLOCK_NAME = /^[a-z][a-z0-9_-]{0,39}(\.[a-z0-9_-]{1,40}){0,3}$/;
const PARAM_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,39}$/;
/** What a parameter can't be called: <use>'s own attributes. */
const RESERVED = new Set(["block", "id", "phone"]);

/** The flow of a block: run="@search" in block "films.finder" is the flow "block.films.finder.search". */
export const blockFlowName = (block: string, flow: string): string => `block.${block}.${flow.trim().toLowerCase()}`;

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" || typeof v === "boolean" ? String(v) : "");

/** A block as it is kept — what is wrong with it said in words (it throws). */
export function normalizeBlock(raw: unknown): BlockDef {
  const o = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const name = str(o.name).toLowerCase();
  if (!BLOCK_NAME.test(name)) throw new Error(`A block's name is lowercase letters, digits, - and _, parts joined by dots ("crm.deal-card") — not “${str(o.name)}”.`);
  const template = typeof o.template === "string" ? o.template.trim() : "";
  if (!template) throw new Error("A block needs a template (the view language).");
  if (template.length > MAX_BLOCK_TEMPLATE) throw new Error(`A block's template is at most ${MAX_BLOCK_TEMPLATE} characters.`);
  const seen = new Set<string>();
  const params = (Array.isArray(o.params) ? o.params : []).map((p): BlockParam => {
    const q = (p && typeof p === "object" ? p : {}) as Record<string, unknown>;
    const pn = str(q.name);
    if (!PARAM_NAME.test(pn)) throw new Error(`A parameter's name is letters, digits and _ — not “${pn}”.`);
    if (RESERVED.has(pn.toLowerCase())) throw new Error(`“${pn}” is <use>'s own attribute — name the parameter differently.`);
    if (seen.has(pn.toLowerCase())) throw new Error(`The parameter “${pn}” is there twice.`);
    seen.add(pn.toLowerCase());
    const type = (BLOCK_PARAM_TYPES as readonly string[]).includes(str(q.type)) ? (str(q.type) as BlockParamType) : "text";
    const options = Array.isArray(q.options) ? q.options.map(str).filter(Boolean).slice(0, 30) : [];
    return {
      name: pn,
      type,
      ...(q.required === true ? { required: true } : {}),
      ...(q.default !== undefined && q.default !== null && str(q.default) !== "" ? { default: str(q.default) } : {}),
      ...(str(q.help) ? { help: str(q.help) } : {}),
      ...(options.length ? { options } : {}),
    };
  });
  if (params.length > 30) throw new Error("A block takes at most 30 parameters.");
  return {
    name,
    ...(str(o.title) ? { title: str(o.title).slice(0, 80) } : {}),
    description: str(o.description).slice(0, 600),
    ...(str(o.icon) ? { icon: str(o.icon).slice(0, 8) } : {}),
    params,
    template,
    ...(str(o.example) ? { example: str(o.example).slice(0, 2000) } : {}),
    ...(str(o.updatedAt) ? { updatedAt: str(o.updatedAt) } : {}),
  };
}

/** A parameter's value from its text (an attribute, after {{ … }}): a number, true/false, or the text. */
export function paramValue(p: BlockParam, text: string): unknown {
  if (p.type === "number") {
    const n = Number(text.trim().replace(",", "."));
    return text.trim() === "" || !Number.isFinite(n) ? null : n;
  }
  if (p.type === "boolean") return ["true", "1", "yes", "ja"].includes(text.trim().toLowerCase());
  return text;
}

/** How a block is written where it is used — the help's and the AI's line for it. */
export function blockSignature(b: BlockDef): string {
  const attrs = b.params.map((p) => ` ${p.name}=${p.type === "list" ? `"rows | …"` : `"${p.options?.length ? p.options.join("|") : p.type}"`}${p.required ? "" : "?"}`).join("");
  return `<use block="${b.name}"${attrs}/>`;
}
