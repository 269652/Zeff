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
    return { block: (await import("../block-store")).saveBlock(r.block, { source: "edit" }) };
  });
}

/** A block's versions, the newest first; and the removed blocks that can be brought back. */
export async function blockVersionsAction(name: string) {
  return run(async () => {
    const s = await import("../block-store");
    return { versions: s.listBlockVersions(String(name)), flows: await s.blockFlows(String(name)) };
  });
}

/** The blocks that were removed but kept their versions. */
export async function removedBlocksAction() {
  return run(async () => ({ removed: (await import("../block-store")).removedBlocks() }));
}

/** An older version of a block brought back (as the newest). */
export async function restoreBlockVersionAction(name: string, n: number) {
  return run(async () => ({ block: (await import("../block-store")).restoreBlockVersion(String(name), Number(n)) }));
}

/** The ready-made blocks (block-library.ts), each with whether it is among your blocks already. */
export async function blockLibraryAction() {
  return run(async () => {
    const { LIBRARY } = await import("../block-library");
    const have = new Set((await import("../block-store")).listBlocks().map((b) => b.name));
    return { library: LIBRARY.map((b) => ({ ...b, installed: have.has(b.name) })) };
  });
}

/** A library block made one of yours (or, with `all`, every one that isn't yet) — yours stay as they are. */
export async function installLibraryBlocksAction(names: string[] | "all") {
  return run(async () => {
    const { LIBRARY } = await import("../block-library");
    const s = await import("../block-store");
    const have = new Set(s.listBlocks().map((b) => b.name));
    const want = names === "all" ? LIBRARY.map((b) => b.name) : names.map((n) => String(n).toLowerCase());
    const made: string[] = [];
    for (const b of LIBRARY) {
      if (!want.includes(b.name) || have.has(b.name)) continue;
      const { category: _c, ...def } = b;
      void _c;
      s.saveBlock(def, { source: "package", note: "library" });
      made.push(b.name);
    }
    return { made };
  });
}

/** A block removed — with its flows, when `flows`. */
export async function deleteBlockAction(name: string, flows = false) {
  return run(async () => ({ gone: await (await import("../block-store")).deleteBlock(String(name), { flows: flows === true }) }));
}
