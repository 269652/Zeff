import type { CollectionProvider } from "@/lib/items/point";
import { getPref, setPref } from "@/lib/prefs";
import type { Collection, Item } from "@/lib/items/shared";
import { getPerson } from "@/plugins/people/store";
import { docText } from "./doc";
import type { DbSchema, Row } from "./model";
import { getDatabase, getPage, rawRows, tree } from "./store";

/**
 * Your Workspace databases as collections (workspace:<id>), their rows as items (page:<id>). What
 * an item has comes from the first property of its kind: a status (its group is the phase), a date
 * (a range: its start), a person, a multi-select (the labels).
 */

const collectionId = (dbId: number) => `workspace:${dbId}`;

/** The databases in the briefing and in the knowledge (none at first). */
const SWITCHES = "workspace.collections";
type Switches = { briefing: number[]; knowledge: number[] };
const switches = (): Switches => ({ briefing: [], knowledge: [], ...getPref<Partial<Switches>>(SWITCHES, {}) });
const named = (icon: string, title: string) => [icon, title || "Untitled"].filter(Boolean).join(" ");

function itemsOf(dbId: number, schema: DbSchema, rows: Row[]): Item[] {
  const first = (type: string) => schema.properties.find((p) => p.type === type);
  const status = first("status");
  const date = first("date");
  const person = first("person");
  const tags = first("multi_select");
  return rows.map((r): Item => {
    const page = getPage(r.id);
    const opt = status && status.options?.find((o) => o.id === r.cells[status.id]);
    const d = date ? r.cells[date.id] : null;
    const who = person ? (r.cells[person.id] as number[] | null)?.[0] : undefined;
    const tagIds = tags ? ((r.cells[tags.id] as string[] | null) ?? []) : [];
    return {
      ref: `page:${r.id}`,
      collectionId: collectionId(dbId),
      kind: "row",
      title: r.title,
      text: docText(page?.content),
      labels: tagIds.flatMap((id) => tags!.options?.find((o) => o.id === id)?.name ?? []),
      status: opt ? { name: opt.name, phase: opt.group ?? "todo" } : null,
      due: typeof d === "string" ? d : d && typeof d === "object" && "start" in d ? String(d.start) : null,
      assignee: who ? (getPerson(who)?.name ?? null) : null,
      color: null,
      pinned: false,
      archived: !!page?.archivedAt,
      parentRef: null,
      href: `/workspace/${r.id}`,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  });
}

export const workspaceCollections: CollectionProvider = {
  collections: () => {
    const on = switches();
    return tree()
      .filter((p) => p.kind === "database")
      .map((p): Collection => {
        const page = getPage(p.id);
        return {
          id: collectionId(p.id),
          plugin: "workspace",
          kind: "database",
          name: named(p.icon, p.title),
          description: "",
          color: null,
          href: `/workspace/${p.id}`,
          readOnly: !!page?.locked,
          briefing: on.briefing.includes(p.id),
          knowledge: on.knowledge.includes(p.id),
          items: rawRows(p.id).length,
        };
      });
  },
  set(id, patch) {
    const m = /^workspace:(\d+)$/.exec(id);
    if (!m || !getDatabase(Number(m[1]))) return false;
    const dbId = Number(m[1]);
    const on = switches();
    const flip = (list: number[], v: boolean | undefined) => (v === undefined ? list : [...list.filter((x) => x !== dbId), ...(v ? [dbId] : [])]);
    setPref(SWITCHES, { briefing: flip(on.briefing, patch.briefing), knowledge: flip(on.knowledge, patch.knowledge) });
    return true;
  },
  items(id) {
    const m = /^workspace:(\d+)$/.exec(id);
    const d = m ? getDatabase(Number(m[1])) : null;
    if (!d || d.page.archivedAt) return null;
    return itemsOf(d.page.id, d.schema, rawRows(d.page.id));
  },
  byRefs(refs) {
    const ids = new Set(refs.flatMap((r) => (/^page:\d+$/.test(r) ? [Number(r.slice(5))] : [])));
    const byDb = new Map<number, number[]>();
    for (const id of ids) {
      const p = getPage(id);
      if (p?.dbId) byDb.set(p.dbId, [...(byDb.get(p.dbId) ?? []), id]);
    }
    const out: Item[] = [];
    for (const [dbId, rowIds] of byDb) {
      const d = getDatabase(dbId);
      if (!d) continue;
      out.push(...itemsOf(dbId, d.schema, rawRows(dbId).filter((r) => rowIds.includes(r.id))));
    }
    return out;
  },
};
