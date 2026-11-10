import { getSqlite } from "@/db";
import { emitChange } from "@/lib/events";
import { blockFlowName, normalizeBlock, type BlockDef } from "./blocks";

/**
 * Where the blocks of your own live (blocks.ts): one row per block, its definition as JSON. Its flows are flows like any other
 * (flows/store.ts), named block.<name>.<flow>. Server only.
 */

function db() {
  const d = getSqlite();
  d.exec("create table if not exists ws_blocks (name text primary key, def text not null, updated_at text not null)");
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

/** A block made or replaced (by its name). */
export function saveBlock(raw: unknown): BlockDef {
  const b = normalizeBlock(raw);
  const at = new Date().toISOString();
  const { updatedAt: _drop, ...def } = b;
  void _drop;
  db().prepare("insert into ws_blocks (name, def, updated_at) values (?, ?, ?) on conflict(name) do update set def = excluded.def, updated_at = excluded.updated_at").run(b.name, JSON.stringify(def), at);
  emitChange("workspace");
  return { ...b, updatedAt: at };
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
export async function blocksFolder(): Promise<number> {
  const found = db().prepare("select id from ws_pages where parent_id is null and kind = 'page' and title = 'Blocks' and icon = '🧩' and archived_at is null order by id limit 1").get() as { id: number } | undefined;
  if (found) return found.id;
  const { createPage } = await import("./store");
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
