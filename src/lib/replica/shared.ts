/**
 * Zeff on the go (the phone's or tablet's offline copy) — the part both sides share, pure and client-safe:
 *
 * - The PC lists every entity it offers (todos, Workspace pages and rows, calendars, events) with a version — a hash of
 *   what the phone keeps of it (a "manifest"). The phone compares it with its own and fetches what changed, drops what's
 *   gone. No timestamps needed (several edits on the PC don't bump one), deletes come along by themselves.
 * - The phone's edits are ops, queued while the PC is away, applied in order when it's back — each once (its id). An
 *   edit of a field carries `base`: the hash of the value the phone saw. Last write wins, field by field: unchanged on the
 *   PC → applied; changed there too → the later edit stays, the other is reported (decideField).
 * - What the phone makes offline has a temporary id ("tmp:…") until the PC gives it a real one; later ops may use it.
 */

/** JSON with every object's keys sorted (the same data, the same text). */
export function stableStringify(v: unknown): string {
  if (v === undefined || v === null) return "null";
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

/** A short hash of a value (FNV-1a, 52 bits — for telling versions apart, not for security). */
export function hashValue(v: unknown): string {
  const s = stableStringify(v);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return (h1.toString(36) + (h2 & 0xfffff).toString(36)).toLowerCase();
}

export type Tmp = `tmp:${string}`;
/** An entity's id in an op: the PC's, or one the phone made offline. */
export type Ref = number | Tmp;
export const isTmp = (v: unknown): v is Tmp => typeof v === "string" && /^tmp:[\w-]{1,80}$/.test(v);
const isRef = (v: unknown): v is Ref => (typeof v === "number" && Number.isInteger(v) && v > 0) || isTmp(v);
const isRefOrNull = (v: unknown) => v === null || isRef(v);

// ---------------------------------------------------------------------------------------------------------------------
// Entities (what the phone keeps)
// ---------------------------------------------------------------------------------------------------------------------

export type TodoStatus = "open" | "done" | "dismissed";
export type RTodo = {
  id: number;
  text: string;
  ticket: string;
  due: string | null;
  status: TodoStatus;
  flagged: boolean;
  deferred: boolean;
  source: string | null;
  notes: { at: string; text: string }[];
  createdAt: string;
  updatedAt: string;
  doneAt: string | null;
};

export type RPage = {
  id: number;
  parentId: number | null;
  /** A row: its database. */
  dbId: number | null;
  kind: "page" | "database" | "form";
  title: string;
  icon: string;
  /** The body (Tiptap/ProseMirror JSON). */
  content: unknown;
  /** A row's cells. */
  props: Record<string, unknown>;
  /** A database's properties and views (src/plugins/workspace/model/schema.ts). */
  schema: unknown;
  position: number;
  favorite: boolean;
  locked: boolean;
  updatedAt: string;
};

export type RCalendar = { id: number; name: string; color: string; source: string; visible: boolean; /** Zeff's own: editable on the phone. */ editable: boolean };

export type REvent = {
  /** "<calendarId>:<key>" — stable (an Outlook/Google sync gives events new ids, not new keys). */
  ref: string;
  calendarId: number;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location: string;
  description: string;
  cancelled: boolean;
  /** A series' rule (read-only on the phone): src/lib/calendar/recurrence.ts. */
  recurrence: unknown;
  exdates: string[];
  updatedAt: string;
};

export type ReplicaEntity =
  | { key: `todo:${number}`; kind: "todo"; data: RTodo }
  | { key: `page:${number}`; kind: "page"; data: RPage }
  | { key: `calendar:${number}`; kind: "calendar"; data: RCalendar }
  | { key: `event:${string}`; kind: "event"; data: REvent };

/** Key → version. */
export type Manifest = Record<string, string>;

/** What the phone has against what the PC has now: fetch the new and changed, drop the gone. */
export function diffManifest(have: Manifest, now: Manifest): { fetch: string[]; drop: string[] } {
  return { fetch: Object.keys(now).filter((k) => have[k] !== now[k]), drop: Object.keys(have).filter((k) => !(k in now)) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Ops (the phone's edits)
// ---------------------------------------------------------------------------------------------------------------------

type Base = { id: string; at: string };
export const TODO_FIELDS = ["status", "text", "due", "flagged"] as const;
export const PAGE_FIELDS = ["title", "content", "icon"] as const;
export const EVENT_FIELDS = ["title", "start", "end", "allDay", "location", "description"] as const;
export type ReplicaOp = Base &
  (
    | { kind: "todo.add"; tmp: Tmp; text: string; due?: string | null }
    | { kind: "todo.set"; todo: Ref; field: (typeof TODO_FIELDS)[number]; value: unknown; base: string }
    | { kind: "todo.note"; todo: Ref; text: string }
    | { kind: "page.add"; tmp: Tmp; parent: Ref | null; title: string }
    | { kind: "page.set"; page: Ref; field: (typeof PAGE_FIELDS)[number]; value: unknown; base: string }
    | { kind: "page.archive"; page: Ref }
    | { kind: "row.add"; tmp: Tmp; db: Ref; title: string; cells: Record<string, unknown> }
    | { kind: "row.cell"; row: Ref; prop: string; value: unknown; base: string }
    | { kind: "row.place"; row: Ref; after: Ref | null; before: Ref | null }
    | { kind: "event.add"; tmp: Tmp; calendarId: number; title: string; start: string; end: string; allDay?: boolean; location?: string; description?: string }
    | { kind: "event.set"; event: string; field: (typeof EVENT_FIELDS)[number]; value: unknown; base: string }
    | { kind: "event.delete"; event: string }
  );

const STAMP = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const str = (v: unknown, max: number) => typeof v === "string" && v.length <= max;
/** An event's ref, or a tmp of one made offline. */
const isEventRef = (v: unknown) => isTmp(v) || (typeof v === "string" && /^\d+:.{1,200}$/.test(v));
/** Values too large for one op are refused (a page body up to 2 MB as text). */
const small = (v: unknown, max = 2_000_000) => {
  try {
    return JSON.stringify(v ?? null).length <= max;
  } catch {
    return false;
  }
};

export function isReplicaOp(v: unknown): v is ReplicaOp {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (!str(o.id, 100) || !o.id || typeof o.at !== "string" || Number.isNaN(Date.parse(o.at))) return false;
  const baseOk = str(o.base, 40);
  switch (o.kind) {
    case "todo.add":
      return isTmp(o.tmp) && str(o.text, 4000) && !!(o.text as string).trim() && (o.due === undefined || o.due === null || (typeof o.due === "string" && DAY.test(o.due)));
    case "todo.set":
      if (!isRef(o.todo) || !baseOk || !TODO_FIELDS.includes(o.field as never)) return false;
      if (o.field === "status") return o.value === "open" || o.value === "done" || o.value === "dismissed";
      if (o.field === "text") return str(o.value, 4000) && !!(o.value as string).trim();
      if (o.field === "due") return o.value === null || (typeof o.value === "string" && DAY.test(o.value));
      return typeof o.value === "boolean";
    case "todo.note":
      return isRef(o.todo) && str(o.text, 20000) && !!(o.text as string).trim();
    case "page.add":
      return isTmp(o.tmp) && isRefOrNull(o.parent) && str(o.title, 500);
    case "page.set":
      if (!isRef(o.page) || !baseOk || !PAGE_FIELDS.includes(o.field as never)) return false;
      return o.field === "content" ? !!o.value && typeof o.value === "object" && small(o.value) : str(o.value, o.field === "icon" ? 64 : 500);
    case "page.archive":
      return isRef(o.page);
    case "row.add":
      return isTmp(o.tmp) && isRef(o.db) && str(o.title, 500) && !!o.cells && typeof o.cells === "object" && !Array.isArray(o.cells) && small(o.cells, 200_000);
    case "row.cell":
      return isRef(o.row) && str(o.prop, 100) && !!o.prop && baseOk && small(o.value, 200_000);
    case "row.place":
      return isRef(o.row) && isRefOrNull(o.after) && isRefOrNull(o.before);
    case "event.add":
      return (
        isTmp(o.tmp) &&
        Number.isInteger(o.calendarId) &&
        str(o.title, 500) &&
        !!(o.title as string).trim() &&
        typeof o.start === "string" &&
        STAMP.test(o.start) &&
        typeof o.end === "string" &&
        STAMP.test(o.end) &&
        (o.location === undefined || str(o.location, 500)) &&
        (o.description === undefined || str(o.description, 20000))
      );
    case "event.set":
      if (!isEventRef(o.event) || !baseOk || !EVENT_FIELDS.includes(o.field as never)) return false;
      if (o.field === "start" || o.field === "end") return typeof o.value === "string" && STAMP.test(o.value);
      if (o.field === "allDay") return typeof o.value === "boolean";
      return str(o.value, o.field === "description" ? 20000 : 500);
    case "event.delete":
      return isEventRef(o.event);
    default:
      return false;
  }
}

/**
 * Last write wins, for one field: `current` on the PC (changed there at `pcAt`), the phone saw `base` (a hash) and set
 * `value` at `opAt`. Unchanged on the PC: applied. Changed on both: the later edit stays — the other is the conflict's
 * `lost` (reported to you).
 */
export function decideField(f: { current: unknown; base: string; value: unknown; opAt: string; pcAt: string | null }): { apply: boolean; same?: true; conflict?: { kept: "phone" | "pc"; lost: unknown } } {
  if (hashValue(f.current) === hashValue(f.value)) return { apply: false, same: true };
  if (hashValue(f.current) === f.base) return { apply: true };
  const phoneLater = !f.pcAt || Date.parse(f.opAt) >= Date.parse(f.pcAt);
  return phoneLater ? { apply: true, conflict: { kept: "phone", lost: f.current } } : { apply: false, conflict: { kept: "pc", lost: f.value } };
}

/** A conflict as reported: what, which field, whose edit stayed and the value that didn't. */
export type ReplicaConflict = { id: string; at: string; key: string; label: string; field: string; kept: "phone" | "pc"; lost: unknown; keptValue: unknown };

/** The answer to the phone's ops: each op's outcome, the real ids of what it made, the conflicts. */
export type OpResult = { id: string; ok: boolean; skipped?: string; error?: string };
export type ApplyAnswer = { results: OpResult[]; ids: Record<string, number | string>; conflicts: ReplicaConflict[] };
