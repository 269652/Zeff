import type { Database } from "better-sqlite3";

/**
 * Who else keeps a person's id: when two profiles become one (mergePeople), what pointed at the one that goes follows to the one that
 * stays — a debt's other side, a case's parties, a bank line, every person field of a Workspace database. Left behind they'd point
 * at nobody. In SQL, on what is stored: a closed row or an archived one follows too, and the plugins that own these tables need not be
 * installed — their data is there all the same. Inside the merge's transaction. Server only.
 */

const has = (d: Database, table: string) => !!d.prepare("select 1 from sqlite_master where type = 'table' and name = ?").get(table);

function movePersonCells(d: Database, keep: number, drop: number): void {
  const update = d.prepare("update ws_pages set props = ? where id = ?");
  for (const db of d.prepare("select id, schema from ws_pages where kind = 'database' and schema like '%\"person\"%'").all() as { id: number; schema: string }[]) {
    const props = (JSON.parse(db.schema) as { properties?: { id: string; type: string }[] }).properties?.filter((p) => p.type === "person").map((p) => p.id) ?? [];
    if (!props.length) continue;
    for (const row of d.prepare("select id, props from ws_pages where db_id = ?").all(db.id) as { id: number; props: string | null }[]) {
      const cells = JSON.parse(row.props || "{}") as Record<string, unknown>;
      let moved = false;
      for (const id of props) {
        const v = cells[id];
        if (!Array.isArray(v) || !v.includes(drop)) continue;
        // (Both named before: one now.)
        cells[id] = [...new Set(v.map((x) => (x === drop ? keep : x)))];
        moved = true;
      }
      if (moved) update.run(JSON.stringify(cells), row.id);
    }
  }
}

export function movePersonRefs(d: Database, keep: number, drop: number): void {
  for (const [table, column] of [["cases", "person_id"], ["case_parties", "person_id"], ["bank_transactions", "person_id"]]) {
    if (has(d, table) && (d.prepare(`pragma table_info(${table})`).all() as { name: string }[]).some((c) => c.name === column)) d.prepare(`update ${table} set ${column} = ? where ${column} = ?`).run(keep, drop);
  }
  if (has(d, "ws_pages")) movePersonCells(d, keep, drop);
}
