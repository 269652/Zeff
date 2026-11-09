/**
 * Zeff on the go — the PC's side (src/lib/replica/shared.ts has the idea): the manifest of everything the phone keeps,
 * those entities by key, and the phone's queued ops applied — in order, each once, last write wins field by field, the
 * conflicts kept for you. Each account its own (the request's account: /<slug>/api/companion/replica).
 */
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { calendarEvents, calendars } from "@/db/schema";
import { getPref, setPref } from "@/lib/prefs";
import * as todos from "@/lib/todos/store";
import { attributed } from "@/lib/todos/activity";
import * as ir from "@/lib/calendar/ir";
import * as ws from "@/plugins/workspace/store";
import { markdownEditable } from "@/plugins/workspace/doc";
import { isInstalled } from "@/plugins/state";
import { decideField, hashValue, isTmp, type ApplyAnswer, type Manifest, type OpResult, type RCalendar, type REvent, type Ref, type ReplicaConflict, type ReplicaEntity, type ReplicaOp, type RPage, type RTodo } from "./shared";

const APPLIED = "replica:applied";
const IDS = "replica:ids";
const CONFLICTS = "replica:conflicts";
const KEEP_APPLIED = 10000;
const KEEP_IDS = 5000;
const KEEP_CONFLICTS = 200;

const json = <T>(s: string | null | undefined, d: T): T => {
  try {
    return s ? (JSON.parse(s) as T) : d;
  } catch {
    return d;
  }
};

// ---------------------------------------------------------------------------------------------------------------------
// What the phone keeps
// ---------------------------------------------------------------------------------------------------------------------

function todoEntities(): ReplicaEntity[] {
  // Yours (not the workers'), open or closed — all of them (you chose the whole copy).
  return todos
    .listTodos({ status: "all", byWorker: false })
    .filter((t) => !t.mergedInto)
    .map((t) => {
      const data: RTodo = {
        id: t.id,
        text: t.text,
        ticket: t.ticket,
        due: t.due,
        status: t.status,
        flagged: !!t.flaggedAt,
        deferred: !!t.deferredAt,
        source: t.source,
        notes: t.userNotes.map((n) => ({ at: n.at, text: n.text })),
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        doneAt: t.doneAt,
      };
      return { key: `todo:${t.id}` as const, kind: "todo" as const, data };
    });
}

function pageEntities(): ReplicaEntity[] {
  if (!isInstalled("workspace")) return [];
  return ws.livePages().map((p) => {
    const data: RPage = { id: p.id, parentId: p.parentId, dbId: p.dbId, kind: p.kind, title: p.title, icon: p.icon, content: p.content, props: p.props, schema: p.schema, position: p.position, favorite: p.favorite, locked: p.locked, updatedAt: p.updatedAt };
    return { key: `page:${p.id}` as const, kind: "page" as const, data };
  });
}

function calendarEntities(): ReplicaEntity[] {
  const db = getDb();
  const cals = db.select().from(calendars).all();
  const out: ReplicaEntity[] = cals.map((c) => {
    const data: RCalendar = { id: c.id, name: c.name, color: c.color, source: c.source, visible: c.visible, editable: c.source === "zeff" };
    return { key: `calendar:${c.id}` as const, kind: "calendar" as const, data };
  });
  for (const e of db.select().from(calendarEvents).all()) {
    if ((e as { proposed?: unknown }).proposed) continue;
    const ref = `${e.calendarId}:${e.key}`;
    const data: REvent = {
      ref,
      calendarId: e.calendarId,
      title: e.title,
      start: e.start,
      end: e.end,
      allDay: e.allDay,
      location: e.location,
      description: e.description,
      cancelled: e.cancelled,
      recurrence: json((e as { recurrence?: string | null }).recurrence, null),
      exdates: json<string[]>((e as { exdates?: string | null }).exdates, []),
      updatedAt: (e as { updatedAt?: string }).updatedAt ?? "",
    };
    out.push({ key: `event:${ref}`, kind: "event", data });
  }
  return out;
}

const allEntities = (): ReplicaEntity[] => [...todoEntities(), ...pageEntities(), ...calendarEntities()];

/** Every entity's key with its version (the hash of what the phone keeps of it). */
export function replicaManifest(): Manifest {
  return Object.fromEntries(allEntities().map((e) => [e.key, hashValue(e.data)]));
}

/** The entities asked for (one that's gone is left out). */
export function replicaEntities(keys: string[]): ReplicaEntity[] {
  const want = new Set(keys);
  return allEntities().filter((e) => want.has(e.key));
}

// ---------------------------------------------------------------------------------------------------------------------
// The phone's ops
// ---------------------------------------------------------------------------------------------------------------------

/** The conflicts kept (newest last): what didn't stay, so you can look and put it back. */
export const replicaConflicts = (): ReplicaConflict[] => getPref<ReplicaConflict[]>(CONFLICTS, []);

/** Looked at: the list emptied (Settings → Mobile access). */
export const clearReplicaConflicts = (): void => setPref(CONFLICTS, []);

/** The PC's id for a ref (a tmp: the id it got when its op was applied; unknown: null). */
function resolver(ids: Record<string, number | string>) {
  return {
    num(r: Ref | null): number | null {
      if (r === null) return null;
      if (!isTmp(r)) return r;
      const v = ids[r];
      return typeof v === "number" ? v : null;
    },
    event(r: string): string | null {
      if (!isTmp(r)) return r;
      const v = ids[r];
      return typeof v === "string" ? v : null;
    },
  };
}

function eventRow(ref: string) {
  const i = ref.indexOf(":");
  const calendarId = Number(ref.slice(0, i));
  const key = ref.slice(i + 1);
  return getDb()
    .select()
    .from(calendarEvents)
    .all()
    .find((e) => e.calendarId === calendarId && e.key === key);
}

/**
 * Apply the phone's ops in the order they were made, each once (its id). A field edit goes by decideField: applied, or
 * not (the PC's later edit stays) — a conflict either way is reported back and kept (replicaConflicts). Everything is
 * yours ("you" in the histories), like an edit on the PC.
 */
export async function applyReplicaOps(ops: ReplicaOp[]): Promise<ApplyAnswer> {
  const applied = getPref<string[]>(APPLIED, []);
  const seen = new Set(applied);
  const ids = getPref<Record<string, number | string>>(IDS, {});
  const ref = resolver(ids);
  const results: OpResult[] = [];
  const conflicts: ReplicaConflict[] = [];
  const made: Record<string, number | string> = {};

  const conflictOf = (o: ReplicaOp, key: string, label: string, field: string, d: ReturnType<typeof decideField>, keptValue: unknown) => {
    if (!d.conflict) return;
    conflicts.push({ id: o.id, at: o.at, key, label, field, kept: d.conflict.kept, lost: d.conflict.lost, keptValue });
  };

  for (const o of [...ops].sort((a, b) => a.at.localeCompare(b.at))) {
    if (seen.has(o.id)) {
      results.push({ id: o.id, ok: true, skipped: "already applied" });
      if ("tmp" in o && ids[o.tmp] !== undefined) made[o.tmp] = ids[o.tmp];
      continue;
    }
    let r: OpResult = { id: o.id, ok: true };
    try {
      switch (o.kind) {
        case "todo.add": {
          const t = todos.addManualTodo({ ticket: "", text: o.text.trim() });
          if (o.due) todos.setTodoDue(t.id, o.due);
          ids[o.tmp] = made[o.tmp] = t.id;
          break;
        }
        case "todo.set": {
          const id = ref.num(o.todo);
          const t = id ? todos.getTodo(id) : undefined;
          if (!t) {
            r = { id: o.id, ok: true, skipped: "todo gone" };
            break;
          }
          const current = o.field === "flagged" ? !!t.flaggedAt : o.field === "status" ? t.status : o.field === "due" ? t.due : t.text;
          const pcAt = o.field === "flagged" ? (t.flaggedAt ?? t.updatedAt) : t.updatedAt;
          const d = decideField({ current, base: o.base, value: o.value, opAt: o.at, pcAt });
          if (d.apply) {
            if (o.field === "status") attributed("you", () => todos.setTodoStatus(t.id, o.value as RTodo["status"], o.value === "open" ? null : undefined));
            else if (o.field === "text") todos.setTodoText(t.id, String(o.value));
            else if (o.field === "due") todos.setTodoDue(t.id, (o.value as string | null) ?? null);
            else todos.setTodoFlagged(t.id, !!o.value);
          } else r = { id: o.id, ok: true, skipped: d.same ? "unchanged" : "conflict: the PC's later edit stays" };
          conflictOf(o, `todo:${t.id}`, d.apply ? String(o.field === "text" ? o.value : t.text) : t.text, o.field, d, d.apply ? o.value : current);
          break;
        }
        case "todo.note": {
          const id = ref.num(o.todo);
          if (!id || !todos.getTodo(id)) r = { id: o.id, ok: true, skipped: "todo gone" };
          else todos.addTodoUserNote(id, o.text.trim());
          break;
        }
        case "page.add": {
          if (!isInstalled("workspace")) throw new Error("The Workspace isn't installed.");
          const parent = ref.num(o.parent);
          ids[o.tmp] = made[o.tmp] = ws.createPage({ parentId: parent, title: o.title });
          break;
        }
        case "page.set": {
          if (!isInstalled("workspace")) throw new Error("The Workspace isn't installed.");
          const id = ref.num(o.page);
          const p = id ? ws.getPage(id) : null;
          if (!p || p.archivedAt) {
            r = { id: o.id, ok: true, skipped: "page gone" };
            break;
          }
          if (p.locked && o.field !== "icon") throw new Error("This page is locked.");
          // A body with blocks Markdown doesn't keep (the phone edits as Markdown): changed on the PC only, nothing lost.
          if (o.field === "content" && !markdownEditable(p.content)) throw new Error("This page has elements only the PC can edit — its text wasn't changed.");
          const current = o.field === "content" ? p.content : o.field === "title" ? p.title : p.icon;
          const d = decideField({ current, base: o.base, value: o.value, opAt: o.at, pcAt: p.updatedAt });
          if (d.apply) ws.updatePage(p.id, { [o.field]: o.value });
          else r = { id: o.id, ok: true, skipped: d.same ? "unchanged" : "conflict: the PC's later edit stays" };
          conflictOf(o, `page:${p.id}`, p.title, o.field, d, d.apply ? o.value : current);
          break;
        }
        case "page.archive": {
          if (!isInstalled("workspace")) throw new Error("The Workspace isn't installed.");
          const id = ref.num(o.page);
          const p = id ? ws.getPage(id) : null;
          if (!p || p.archivedAt) r = { id: o.id, ok: true, skipped: "already gone" };
          else {
            await (await import("@/plugins/workspace/source-write")).removeFromSource(p.id);
            ws.archivePage(p.id);
          }
          break;
        }
        case "row.add": {
          if (!isInstalled("workspace")) throw new Error("The Workspace isn't installed.");
          const db = ref.num(o.db);
          if (!db || !ws.getPage(db)) throw new Error("The database is gone.");
          const id = ws.addRow(db, { title: o.title, cells: o.cells });
          ids[o.tmp] = made[o.tmp] = id;
          if (o.title.trim()) void import("@/plugins/workspace/pipeline").then((p) => p.syncAfterEdit(id)).catch(() => undefined);
          break;
        }
        case "row.cell": {
          if (!isInstalled("workspace")) throw new Error("The Workspace isn't installed.");
          const id = ref.num(o.row);
          const row = id ? ws.getPage(id) : null;
          if (!row || row.archivedAt || !row.dbId) {
            r = { id: o.id, ok: true, skipped: "row gone" };
            break;
          }
          const current = row.props[o.prop] ?? null;
          const d = decideField({ current, base: o.base, value: o.value, opAt: o.at, pcAt: row.updatedAt });
          if (d.apply) {
            ws.setCell(row.id, o.prop, o.value);
            void import("@/plugins/workspace/pipeline").then((p) => p.syncAfterEdit(row.id)).catch(() => undefined);
          } else r = { id: o.id, ok: true, skipped: d.same ? "unchanged" : "conflict: the PC's later edit stays" };
          conflictOf(o, `page:${row.id}`, row.title, o.prop, d, d.apply ? o.value : current);
          break;
        }
        case "row.place": {
          if (!isInstalled("workspace")) throw new Error("The Workspace isn't installed.");
          const id = ref.num(o.row);
          if (!id || !ws.getPage(id)) r = { id: o.id, ok: true, skipped: "row gone" };
          else ws.placeRow(id, { after: ref.num(o.after), before: ref.num(o.before) });
          break;
        }
        case "event.add": {
          const c = getDb().select().from(calendars).where(eq(calendars.id, o.calendarId)).get();
          if (!c || c.source !== "zeff") throw new Error("Events can be made offline only in Zeff's own calendars.");
          const e = ir.addEvent(o.calendarId, { title: o.title.trim(), start: o.start, end: o.end, allDay: !!o.allDay, location: o.location ?? "", description: o.description ?? "" });
          const key = (e as { key: string }).key;
          ids[o.tmp] = made[o.tmp] = `${o.calendarId}:${key}`;
          break;
        }
        case "event.set": {
          const rf = ref.event(o.event);
          const e = rf ? eventRow(rf) : undefined;
          if (!e) {
            r = { id: o.id, ok: true, skipped: "event gone" };
            break;
          }
          const current = (e as Record<string, unknown>)[o.field];
          const d = decideField({ current, base: o.base, value: o.value, opAt: o.at, pcAt: (e as { updatedAt?: string }).updatedAt ?? null });
          if (d.apply) ir.updateEvent(e.id, { [o.field]: o.value });
          else r = { id: o.id, ok: true, skipped: d.same ? "unchanged" : "conflict: the PC's later edit stays" };
          conflictOf(o, `event:${rf}`, e.title, o.field, d, d.apply ? o.value : current);
          break;
        }
        case "event.delete": {
          const rf = ref.event(o.event);
          const e = rf ? eventRow(rf) : undefined;
          if (!e) r = { id: o.id, ok: true, skipped: "already gone" };
          else ir.deleteEvent(e.id);
          break;
        }
      }
      seen.add(o.id);
      applied.push(o.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      r = { id: o.id, ok: false, error: /own calendars/i.test(msg) ? "Events can be changed offline only in Zeff's own calendars." : msg };
    }
    results.push(r);
  }
  setPref(APPLIED, applied.slice(-KEEP_APPLIED));
  setPref(IDS, Object.fromEntries(Object.entries(ids).slice(-KEEP_IDS)));
  if (conflicts.length) setPref(CONFLICTS, [...replicaConflicts(), ...conflicts].slice(-KEEP_CONFLICTS));
  return { results, ids: made, conflicts };
}
