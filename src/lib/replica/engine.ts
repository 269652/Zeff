/**
 * Zeff on the go — the phone's side (bundled into the app at app.getzeff.com; pure, no DOM but `idbStore`): the copy
 * of an account's entities as the PC last sent them, the queue of your edits, and what you see — the copy with the queue
 * applied on top, so an edit shows at once, online or not. `sync` sends the queue (each op once — the PC remembers),
 * then fetches what changed by the manifest. Everything is kept in storage: the app closed and opened again (or the
 * phone restarted) has its copy and queue still.
 */
import { diffManifest, hashValue, isTmp, type ApplyAnswer, type Manifest, type Ref, type ReplicaConflict, type ReplicaEntity, type ReplicaOp, type RPage, type RTodo, type REvent, type RCalendar, type Tmp } from "./shared";

export type Transport = (method: "GET" | "POST", path: string, body?: unknown) => Promise<unknown>;

/** Key-value storage (IndexedDB on the phone, a Map in the tests). */
export type KV = {
  get<T>(k: string): Promise<T | undefined>;
  set(k: string, v: unknown): Promise<void>;
  del(k: string): Promise<void>;
  /** Every key that starts with `prefix`, with its value. */
  entries<T>(prefix: string): Promise<[string, T][]>;
};

export function memoryStore(): KV {
  const m = new Map<string, unknown>();
  return {
    get: async <T>(k: string) => structuredClone(m.get(k)) as T | undefined,
    set: async (k, v) => void m.set(k, structuredClone(v)),
    del: async (k) => void m.delete(k),
    entries: async <T>(p: string) => [...m].filter(([k]) => k.startsWith(p)).map(([k, v]) => [k, structuredClone(v) as T]),
  };
}

/** IndexedDB (the browser): one store of keys and values. */
export function idbStore(name = "zeff-replica"): KV {
  let opened: Promise<IDBDatabase> | null = null;
  const open = () =>
    (opened ??= new Promise((ok, no) => {
      const r = indexedDB.open(name, 1);
      r.onupgradeneeded = () => r.result.createObjectStore("kv");
      r.onsuccess = () => ok(r.result);
      r.onerror = () => no(r.error);
    }));
  const tx = async <T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>) => {
    const db = await open();
    return new Promise<T>((ok, no) => {
      const req = f(db.transaction("kv", mode).objectStore("kv"));
      req.onsuccess = () => ok(req.result);
      req.onerror = () => no(req.error);
    });
  };
  return {
    get: <T>(k: string) => tx<T | undefined>("readonly", (s) => s.get(k) as IDBRequest<T | undefined>),
    set: async (k, v) => void (await tx("readwrite", (s) => s.put(v, k))),
    del: async (k) => void (await tx("readwrite", (s) => s.delete(k))),
    entries: async <T>(p: string) => {
      const range = IDBKeyRange.bound(p, `${p}￿`);
      const [keys, vals] = await Promise.all([tx<IDBValidKey[]>("readonly", (s) => s.getAllKeys(range)), tx<T[]>("readonly", (s) => s.getAll(range))]);
      return keys.map((k, i) => [String(k), vals[i]] as [string, T]);
    },
  };
}

type Kinds = { todo: RTodo; page: RPage; calendar: RCalendar; event: REvent };
type Data = ReplicaEntity["data"];
/** An edit as the app makes it: id, time, base and tmp filled in here. */
export type Edit = ReplicaOp extends infer O ? (O extends ReplicaOp ? Omit<O, "id" | "at" | "base" | "tmp"> : never) : never;

const uid = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`).replace(/[^\w-]/g, "");
const keyOf = (kind: string, ref: Ref | string) => `${kind}:${ref}`;

export class ReplicaEngine {
  private base = new Map<string, ReplicaEntity>();
  private view = new Map<string, Data>();
  private versions: Manifest = {};
  private outbox: ReplicaOp[] = [];
  private conflictsKept: ReplicaConflict[] = [];
  private failed: { op: ReplicaOp; error: string }[] = [];
  lastSync: string | null = null;

  constructor(
    private kv: KV,
    readonly account: string,
  ) {}

  private k = (s: string) => `${this.account}/${s}`;

  async load(): Promise<void> {
    this.base = new Map((await this.kv.entries<ReplicaEntity>(this.k("e/"))).map(([, e]) => [e.key, e]));
    this.versions = (await this.kv.get<Manifest>(this.k("v"))) ?? {};
    this.outbox = (await this.kv.get<ReplicaOp[]>(this.k("q"))) ?? [];
    this.conflictsKept = (await this.kv.get<ReplicaConflict[]>(this.k("c"))) ?? [];
    this.failed = (await this.kv.get<typeof this.failed>(this.k("f"))) ?? [];
    this.lastSync = (await this.kv.get<string>(this.k("at"))) ?? null;
    this.rebuild();
  }

  // -------------------------------------------------------------------------------------------------------------------
  // What you see
  // -------------------------------------------------------------------------------------------------------------------

  get<K extends keyof Kinds = "todo">(key: string): Kinds[K] | undefined {
    return this.view.get(key) as Kinds[K] | undefined;
  }
  list<K extends keyof Kinds>(kind: K): Kinds[K][] {
    return [...this.view].filter(([k]) => k.startsWith(`${kind}:`)).map(([, d]) => d as Kinds[K]);
  }
  pending(): ReplicaOp[] {
    return [...this.outbox];
  }
  conflicts(): ReplicaConflict[] {
    return [...this.conflictsKept];
  }
  failures(): { op: ReplicaOp; error: string }[] {
    return [...this.failed];
  }
  async dismissConflicts(): Promise<void> {
    this.conflictsKept = [];
    this.failed = [];
    await this.kv.set(this.k("c"), []);
    await this.kv.set(this.k("f"), []);
  }

  private rebuild(): void {
    this.view = new Map([...this.base].map(([k, e]) => [k, structuredClone(e.data)]));
    for (const o of this.outbox) applyOp(this.view, o);
  }

  // -------------------------------------------------------------------------------------------------------------------
  // Your edits
  // -------------------------------------------------------------------------------------------------------------------

  /** An edit: shown at once, queued for the PC. A new thing's tmp id is the answer (later edits may use it). */
  async edit(e: Edit): Promise<Tmp | undefined> {
    const op = { ...e, id: uid(), at: new Date().toISOString() } as ReplicaOp & { base?: string; tmp?: Tmp };
    if (e.kind.endsWith(".add")) op.tmp = `tmp:${uid()}`;
    const field = fieldOf(this.view, op);
    if (field !== undefined) op.base = hashValue(field.current);
    applyOp(this.view, op);
    this.outbox.push(op);
    await this.kv.set(this.k("q"), this.outbox);
    return op.tmp;
  }

  // -------------------------------------------------------------------------------------------------------------------
  // With the PC
  // -------------------------------------------------------------------------------------------------------------------

  /**
   * The queue to the PC (in parts), then what changed from it. Throws when the PC can't be reached — the queue stays.
   * `prefix`: the account's route ("/privat"; "" for the PC's first account).
   */
  async sync(transport: Transport, prefix: string): Promise<{ sent: number; fetched: number; dropped: number; conflicts: ReplicaConflict[] }> {
    const path = `${prefix}/api/companion/replica`;
    let sent = 0;
    const newConflicts: ReplicaConflict[] = [];
    while (this.outbox.length) {
      const part = this.outbox.slice(0, 200);
      const a = (await transport("POST", path, { ops: part })) as ApplyAnswer;
      const answered = new Map(a.results.map((r) => [r.id, r]));
      for (const o of part) {
        const r = answered.get(o.id);
        if (r && !r.ok) this.failed.push({ op: o, error: r.error ?? "failed" });
      }
      // Answered ops leave the queue (done, skipped, or failed — a failed one is kept in `failures` for you to see).
      this.outbox = this.outbox.filter((o) => !answered.has(o.id));
      newConflicts.push(...a.conflicts);
      sent += answered.size;
      await this.kv.set(this.k("q"), this.outbox);
      if (!answered.size) break;
    }
    if (newConflicts.length) {
      this.conflictsKept = [...this.conflictsKept, ...newConflicts].slice(-200);
      await this.kv.set(this.k("c"), this.conflictsKept);
    }
    await this.kv.set(this.k("f"), this.failed.slice(-100));

    const m = (await transport("GET", path)) as { at: string; manifest: Manifest };
    const { fetch, drop } = diffManifest(this.versions, m.manifest);
    for (let i = 0; i < fetch.length; i += 500) {
      const got = (await transport("POST", path, { want: fetch.slice(i, i + 500) })) as { entities: ReplicaEntity[] };
      for (const e of got.entities) {
        this.base.set(e.key, e);
        this.versions[e.key] = hashValue(e.data);
        await this.kv.set(this.k(`e/${e.key}`), e);
      }
    }
    for (const key of drop) {
      this.base.delete(key);
      delete this.versions[key];
      await this.kv.del(this.k(`e/${key}`));
    }
    await this.kv.set(this.k("v"), this.versions);
    this.lastSync = m.at;
    await this.kv.set(this.k("at"), m.at);
    this.rebuild();
    return { sent, fetched: fetch.length, dropped: drop.length, conflicts: newConflicts };
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// An op on the phone's view (the PC does the real thing; this shows it at once)
// ---------------------------------------------------------------------------------------------------------------------

/** The field an op changes, as the view has it now (its base is this value's hash). */
function fieldOf(view: Map<string, Data>, o: ReplicaOp): { current: unknown } | undefined {
  if (o.kind === "todo.set") {
    const t = view.get(keyOf("todo", o.todo)) as RTodo | undefined;
    return { current: t ? t[o.field] : null };
  }
  if (o.kind === "page.set") {
    const p = view.get(keyOf("page", o.page)) as RPage | undefined;
    return { current: p ? p[o.field] : null };
  }
  if (o.kind === "row.cell") {
    const p = view.get(keyOf("page", o.row)) as RPage | undefined;
    return { current: p?.props?.[o.prop] ?? null };
  }
  if (o.kind === "event.set") {
    const ev = view.get(keyOf("event", o.event)) as REvent | undefined;
    return { current: ev ? ev[o.field] : null };
  }
  return undefined;
}

const EMPTY_DOC = { type: "doc", content: [{ type: "paragraph" }] };

export function applyOp(view: Map<string, Data>, o: ReplicaOp): void {
  const at = o.at;
  switch (o.kind) {
    case "todo.add":
      view.set(keyOf("todo", o.tmp), { id: o.tmp as unknown as number, text: o.text, ticket: "", due: o.due ?? null, status: "open", flagged: false, deferred: false, source: null, notes: [], createdAt: at, updatedAt: at, doneAt: null });
      return;
    case "todo.set": {
      const t = view.get(keyOf("todo", o.todo)) as RTodo | undefined;
      if (!t) return;
      (t as Record<string, unknown>)[o.field] = o.value;
      if (o.field === "status") t.doneAt = o.value === "open" ? null : at;
      t.updatedAt = at;
      return;
    }
    case "todo.note": {
      const t = view.get(keyOf("todo", o.todo)) as RTodo | undefined;
      t?.notes.push({ at, text: o.text });
      return;
    }
    case "page.add":
      view.set(keyOf("page", o.tmp), { id: o.tmp as unknown as number, parentId: o.parent as number | null, dbId: null, kind: "page", title: o.title, icon: "", content: EMPTY_DOC, props: {}, schema: null, position: Date.now(), favorite: false, locked: false, updatedAt: at });
      return;
    case "page.set": {
      const p = view.get(keyOf("page", o.page)) as RPage | undefined;
      if (!p) return;
      (p as Record<string, unknown>)[o.field] = o.value;
      p.updatedAt = at;
      return;
    }
    case "page.archive": {
      // The page and everything below it (its sub-pages; a database's rows).
      const gone = new Set<string>([String(o.page)]);
      let more = true;
      while (more) {
        more = false;
        for (const [k, d] of view) {
          if (!k.startsWith("page:")) continue;
          const p = d as RPage;
          if (!gone.has(String(p.id)) && ((p.parentId !== null && gone.has(String(p.parentId))) || (p.dbId !== null && gone.has(String(p.dbId))))) {
            gone.add(String(p.id));
            more = true;
          }
        }
      }
      for (const id of gone) view.delete(keyOf("page", id));
      return;
    }
    case "row.add":
      view.set(keyOf("page", o.tmp), { id: o.tmp as unknown as number, parentId: null, dbId: o.db as number, kind: "page", title: o.title, icon: "", content: EMPTY_DOC, props: { ...o.cells }, schema: null, position: Number.MAX_SAFE_INTEGER, favorite: false, locked: false, updatedAt: at });
      return;
    case "row.cell": {
      const p = view.get(keyOf("page", o.row)) as RPage | undefined;
      if (!p) return;
      p.props = { ...p.props, [o.prop]: o.value };
      p.updatedAt = at;
      return;
    }
    case "row.place": {
      const p = view.get(keyOf("page", o.row)) as RPage | undefined;
      if (!p) return;
      const pos = (r: Ref | null) => (r === null ? null : ((view.get(keyOf("page", r)) as RPage | undefined)?.position ?? null));
      const a = pos(o.after);
      const b = pos(o.before);
      p.position = a !== null && b !== null ? (a + b) / 2 : a !== null ? a + 1 : b !== null ? b - 1 : p.position;
      return;
    }
    case "event.add":
      view.set(keyOf("event", o.tmp), { ref: o.tmp, calendarId: o.calendarId, title: o.title, start: o.start, end: o.end, allDay: !!o.allDay, location: o.location ?? "", description: o.description ?? "", cancelled: false, recurrence: null, exdates: [], updatedAt: at });
      return;
    case "event.set": {
      const ev = view.get(keyOf("event", o.event)) as REvent | undefined;
      if (!ev) return;
      (ev as Record<string, unknown>)[o.field] = o.value;
      ev.updatedAt = at;
      return;
    }
    case "event.delete":
      view.delete(keyOf("event", o.event));
      return;
  }
}

export { isTmp };
