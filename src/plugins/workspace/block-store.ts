import { getSqlite } from "@/db";
import { emitChange } from "@/lib/events";
import { createPage } from "./store";
import { blockFlowName, normalizeBlock, type BlockDef } from "./blocks";

/**
 * Where the blocks of your own live (blocks.ts): one row per block, its definition as JSON. Its flows are flows like any other
 * (flows/store.ts), named block.<name>.<flow>. Server only.
 */

function db() {
  const d = getSqlite();
  d.exec("create table if not exists ws_blocks (name text primary key, def text not null, updated_at text not null)");
  d.exec(
    "create table if not exists ws_block_versions (name text not null, n integer not null, at text not null, source text not null, note text not null default '', def text not null, primary key (name, n))",
  );
  return d;
}

type BRow = { name: string; def: string; updated_at: string };

const toBlock = (r: BRow): BlockDef | null => {
  try {
    return { ...normalizeBlock({ ...JSON.parse(r.def), name: r.name }), updatedAt: r.updated_at };
  } catch {
    return null;
  }
};

/** Every block, by name. */
export function listBlocks(): BlockDef[] {
  return (db().prepare("select * from ws_blocks order by name").all() as BRow[]).map(toBlock).filter((b): b is BlockDef => !!b);
}

export function getBlock(name: string): BlockDef | null {
  const r = db().prepare("select * from ws_blocks where name = ?").get(name.trim().toLowerCase()) as BRow | undefined;
  return r ? toBlock(r) : null;
}

export const MAX_BLOCK_VERSIONS = 40;
export type BlockVersionSource = "ai" | "edit" | "restore" | "package" | "first";
export type BlockVersion = { n: number; at: string; source: BlockVersionSource; note: string; size: number };

/** A block made or replaced (by its name); every change is kept as a version (the same as the newest: not again). */
export function saveBlock(raw: unknown, opts: { source?: BlockVersionSource; note?: string } = {}): BlockDef {
  const b = normalizeBlock(raw);
  const at = new Date().toISOString();
  const { updatedAt: _drop, ...def } = b;
  void _drop;
  const json = JSON.stringify(def);
  const last = db().prepare("select n, def from ws_block_versions where name = ? order by n desc limit 1").get(b.name) as { n: number; def: string } | undefined;
  if (!last || last.def !== json) {
    db().prepare("insert into ws_block_versions (name, n, at, source, note, def) values (?, ?, ?, ?, ?, ?)").run(b.name, (last?.n ?? 0) + 1, at, opts.source ?? (last ? "edit" : "first"), (opts.note ?? "").slice(0, 300), json);
    db().prepare("delete from ws_block_versions where name = ? and n <= (select max(n) from ws_block_versions where name = ?) - ?").run(b.name, b.name, MAX_BLOCK_VERSIONS);
  }
  db().prepare("insert into ws_blocks (name, def, updated_at) values (?, ?, ?) on conflict(name) do update set def = excluded.def, updated_at = excluded.updated_at").run(b.name, JSON.stringify(def), at);
  emitChange("workspace");
  return { ...b, updatedAt: at };
}

/** A block's versions, the newest first. */
export function listBlockVersions(name: string): BlockVersion[] {
  return (db().prepare("select n, at, source, note, length(def) size from ws_block_versions where name = ? order by n desc").all(name.trim().toLowerCase()) as BlockVersion[]).map((r) => ({ ...r }));
}

/** One version's definition. */
export function getBlockVersion(name: string, n: number): BlockDef | null {
  const r = db().prepare("select def from ws_block_versions where name = ? and n = ?").get(name.trim().toLowerCase(), n) as { def: string } | undefined;
  if (!r) return null;
  try {
    return normalizeBlock({ ...JSON.parse(r.def), name: name.trim().toLowerCase() });
  } catch {
    return null;
  }
}

/** An older version brought back (kept as a new version, so nothing is lost). */
export function restoreBlockVersion(name: string, n: number): BlockDef {
  const v = getBlockVersion(name, n);
  if (!v) throw new Error(`There is no version ${n} of the block “${name}”.`);
  return saveBlock(v, { source: "restore", note: `back to version ${n}` });
}

/** Blocks that were removed but have versions left — they can be brought back. */
export function removedBlocks(): { name: string; at: string }[] {
  return db().prepare("select v.name, max(v.at) at from ws_block_versions v where v.name not in (select name from ws_blocks) group by v.name order by at desc").all() as { name: string; at: string }[];
}

/** A block removed — and its flows (block.<name>.*), when `flows`. Whether it was there. */
export async function deleteBlock(name: string, opts: { flows?: boolean } = {}): Promise<boolean> {
  const n = name.trim().toLowerCase();
  const gone = db().prepare("delete from ws_blocks where name = ?").run(n).changes > 0;
  if (gone && opts.flows) {
    const { listFlows, deleteFlow } = await import("./flows/store");
    const prefix = blockFlowName(n, "");
    for (const f of listFlows()) if (f.name.startsWith(prefix)) deleteFlow(f.pageId);
  }
  if (gone) emitChange("workspace");
  return gone;
}

/** The page the blocks' flows stand under ("Blocks", made the first time) — so they don't fill the top of the tree. */
export function blocksFolder(): number {
  const found = db().prepare("select id from ws_pages where parent_id is null and kind = 'page' and title = 'Blocks' and icon = '🧩' and archived_at is null order by id limit 1").get() as { id: number } | undefined;
  if (found) return found.id;
  return createPage({ title: "Blocks", icon: "🧩" });
}

/** The flows a block has (block.<name>.*). */
export async function blockFlows(name: string): Promise<{ name: string; pageId: number; title: string }[]> {
  const { listFlows } = await import("./flows/store");
  const prefix = blockFlowName(name.trim().toLowerCase(), "");
  return listFlows()
    .filter((f) => f.name.startsWith(prefix))
    .map((f) => ({ name: f.name, pageId: f.pageId, title: f.title }));
}
