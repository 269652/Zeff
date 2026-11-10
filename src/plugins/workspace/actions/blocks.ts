"use server";

import { run } from "./shared";

// ---------------------------------------------------------------------------
// Blocks of your own (blocks.ts): what the views draw them with, and keeping them
// ---------------------------------------------------------------------------

/** Every block of your own — a view draws <use block=…> with them. */
export async function listBlocksAction() {
  return run(async () => ({ blocks: (await import("../block-store")).listBlocks() }));
}

/** A block made or replaced; what is wrong with its template named (it is saved only without mistakes). */
export async function saveBlockAction(def: unknown) {
  return run(async () => {
    const { checkBlock } = await import("../block-check");
    const r = checkBlock(def);
    if (r.errors.length) throw new Error(r.errors.map((e) => `${e.line}: ${e.message}`).join(" · "));
    return { block: (await import("../block-store")).saveBlock(r.block) };
  });
}

/** A block removed — with its flows, when `flows`. */
export async function deleteBlockAction(name: string, flows = false) {
  return run(async () => ({ gone: await (await import("../block-store")).deleteBlock(String(name), { flows: flows === true }) }));
}
