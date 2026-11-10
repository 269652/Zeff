import { normalizeBlock, type BlockDef } from "./blocks";
import { listBlocks } from "./block-store";
import { getDatabase, rowsOf } from "./store";
import { parseView, renderView, type TplError } from "./view-template";

/**
 * A block checked before it is kept (blocks.ts): its template drawn as it would be used — its example (a <use …/> line, maybe in a
 * list) or a use with its required parameters — on a database's rows when one is named, at the top of a view and in a row's item.
 * A mistake that shows in both is one; one that shows only at the top is a block made for a row (its fields are names there).
 * Without a database only what doesn't depend on one counts (the tags, filters, attributes, its own names). Server only.
 */

const NAME_ERR = /^(block “[^”]+”, line \d+: )?(There is no (property )?“|<[a-z]+>: there is no property|<rating prop=)/;

export function checkBlock(raw: unknown, opts: { dbId?: number } = {}): { block: BlockDef; errors: TplError[]; flowsUsed: string[] } {
  let block: BlockDef;
  try {
    block = normalizeBlock(raw);
  } catch (e) {
    return { block: { name: "", description: "", params: [], template: "" }, errors: [{ line: 0, message: (e as Error).message }], flowsUsed: [] };
  }
  const parsed = parseView(block.template);
  if (parsed.errors.length) return { block, errors: parsed.errors, flowsUsed: [] };
  const blocks = [...listBlocks().filter((b) => b.name !== block.name), block];
  const use =
    block.example?.includes(`"${block.name}"`) && block.example.includes("<use")
      ? block.example
      : `<use block="${block.name}"${block.params
          .filter((p) => p.required)
          .map((p) => ` ${p.name}="${p.type === "list" ? "rows" : p.options?.[0] ?? p.default ?? (p.type === "number" ? "1" : p.type === "boolean" ? "true" : p.type === "color" ? "#6366f1" : "x")}"`)
          .join("")}/>`;
  const d = opts.dbId ? getDatabase(Number(opts.dbId)) : null;
  const data = d ? rowsOf(d.page.id) : null;
  const base = {
    rows: data?.rows.slice(0, 50) ?? [],
    props: d?.schema.properties ?? [],
    titleName: d?.schema.titleName ?? "Name",
    state: {},
    app: {},
    data: {},
    db: { id: d?.page.id ?? 0, title: d?.page.title ?? "" },
  };
  const draw = (src: string) => renderView(src, base, { blocks }).errors;
  const top = draw(use);
  // (In a row's item, too — a block made for a row; its example may already stand in one.)
  const inRow = base.rows.length && !/<(list|cards|selected)[\s>]/.test(use) ? draw(`<list source="rows | limit(3)">${use}</list>`) : top;
  const seen = new Set(inRow.map((e) => e.message));
  let errors = top.filter((e) => seen.has(e.message));
  if (!d) errors = errors.filter((e) => !NAME_ERR.test(e.message));
  // A mistake in its own template by its own line ("block “x”, line 3: …" → line 3).
  const own = `block “${block.name}”, line `;
  errors = errors.map((e) => {
    const m = e.message.startsWith(own) ? /^(\d+): ([\s\S]*)$/.exec(e.message.slice(own.length)) : null;
    return m ? { line: Number(m[1]), message: m[2] } : { line: 0, message: `where it is used: ${e.message}` };
  });
  // Its own flows it calls (@name, as block.<name>.<flow> after the drawing): said back, so the caller sees what must exist.
  const flowsUsed = [...block.template.matchAll(/\b(?:run|flow)="@([\w-]+)"/g)].map((m) => m[1].toLowerCase());
  return { block, errors, flowsUsed: [...new Set(flowsUsed)] };
}
