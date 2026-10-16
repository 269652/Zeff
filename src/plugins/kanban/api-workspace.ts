import { collectionItems, listCollections } from "@/lib/items";
import { markdownToDoc } from "@/plugins/workspace/doc";
import type { Property } from "@/plugins/workspace/model";
import { addRow, archivePage, getDatabase, getPage, setCell, updatePage } from "@/plugins/workspace/store";
import { rowKey } from "@/plugins/workspace/collections";
import { movedCard } from "./to-workspace";

/**
 * Kanban's API on the boards that are Workspace databases now (moved Kanban boards, boards made in the Workspace):
 * listed as workspace:<id>, their columns the status options; a card added is a row; a moved card (by its Kanban id)
 * is changed, moved and archived as its row. Read through ./api.
 */

export type WsBoard = { id: string; dbId: number; name: string; columns: { id: string; name: string; done: boolean }[] };

const statusOf = (dbId: number): Property | undefined => getDatabase(dbId)?.schema.properties.find((p) => p.type === "status");
const propNamed = (dbId: number, name: string): Property | undefined => getDatabase(dbId)?.schema.properties.find((p) => p.name.toLowerCase() === name.toLowerCase());

/** The Workspace's boards (not those a sync keeps: Jira's are read-only), with their columns. */
export function workspaceBoardList(): WsBoard[] {
  return listCollections({ plugin: "workspace" })
    .filter((c) => c.kind === "board" && !c.source)
    .map((c) => {
      const dbId = Number(c.id.slice("workspace:".length));
      return { id: c.id, dbId, name: getDatabase(dbId)?.page.title ?? c.name, columns: (statusOf(dbId)?.options ?? []).map((o) => ({ id: o.id, name: o.name, done: o.group === "done" })) };
    });
}

/** A Workspace board as Kanban's API shows a board: its columns with their cards. */
export function workspaceBoardView(id: string) {
  const b = workspaceBoardList().find((x) => x.id === id);
  if (!b) return null;
  const items = collectionItems(b.id) ?? [];
  return {
    id: b.id,
    name: b.name,
    description: "",
    columns: b.columns.map((col) => ({
      id: col.id,
      name: col.name,
      done: col.done,
      wipLimit: null,
      cards: items.filter((it) => it.status?.name === col.name).map((it) => ({ ref: it.key ?? it.ref, title: it.title, description: it.text, labels: it.labels, due: it.due, assignee: it.assignee })),
    })),
  };
}

/** A board and column by name (any case; a part of the name will do), for the AI's offer: the first board / column without. */
export function findWorkspaceColumn(board: string, column: string): { dbId: number; board: string; statusId: string; column: string } | null {
  const boards = workspaceBoardList();
  const want = board.trim().toLowerCase();
  const b = (want && (boards.find((x) => x.name.toLowerCase() === want) ?? boards.find((x) => x.name.toLowerCase().includes(want)))) || (want ? null : boards[0]);
  if (!b) return null;
  const wantCol = column.trim().toLowerCase();
  const col = (wantCol && (b.columns.find((c) => c.name.toLowerCase() === wantCol) ?? b.columns.find((c) => c.name.toLowerCase().includes(wantCol)))) || b.columns[0];
  return col ? { dbId: b.dbId, board: b.name, statusId: col.id, column: col.name } : null;
}

/** A card added to a Workspace board: a row in the column (status), its description its page. */
export function addWorkspaceCard(dbId: number, statusId: string, title: string, description = "") {
  const status = statusOf(dbId);
  const row = addRow(dbId, { title, cells: status ? { [status.id]: statusId } : {} });
  if (description.trim()) updatePage(row, { content: markdownToDoc(description) });
  return { ref: rowKey({ id: row, cells: getPage(row)!.props }) ?? `page:${row}`, title };
}

/** The row a moved card became (null: not moved). */
export const movedCardRow = (cardId: number): number | null => movedCard(cardId);

/** A moved card's row changed (title, description, labels, priority, due, assignee — by their properties' names). */
export function updateWorkspaceCard(row: number, patch: { title?: string; description?: string; labels?: string[]; priority?: string | null; due?: string | null; assignee?: string | null }): void {
  const db = getPage(row)?.dbId;
  if (!db) throw new Error("No such card.");
  if (patch.title !== undefined) updatePage(row, { title: patch.title });
  if (patch.description !== undefined) updatePage(row, { content: markdownToDoc(patch.description) });
  const byName = (name: string, value: unknown) => {
    const p = propNamed(db, name);
    if (!p) return;
    if (p.type === "select" || p.type === "multi_select") {
      const names = Array.isArray(value) ? value : value === null ? [] : [value];
      const ids = names.flatMap((n) => p.options?.find((o) => o.name.toLowerCase() === String(n).toLowerCase())?.id ?? []);
      setCell(row, p.id, p.type === "select" ? (ids[0] ?? null) : ids);
    } else setCell(row, p.id, value);
  };
  if (patch.labels !== undefined) byName("Labels", patch.labels);
  if (patch.priority !== undefined) byName("Priority", patch.priority);
  if (patch.due !== undefined) byName("Due", patch.due);
  if (patch.assignee !== undefined) byName("Assignee", patch.assignee);
}

/** A moved card's row into the column named. */
export function moveWorkspaceCard(row: number, column: string): void {
  const db = getPage(row)?.dbId;
  const status = db ? statusOf(db) : undefined;
  const want = column.trim().toLowerCase();
  const o = status?.options?.find((x) => x.name.toLowerCase() === want) ?? status?.options?.find((x) => x.name.toLowerCase().includes(want));
  if (!status || !o) throw new Error(`No column “${column}”.`);
  setCell(row, status.id, o.id);
}

/** A moved card's row archived (to the trash, restorable). */
export const archiveWorkspaceCard = (row: number): void => archivePage(row);
