import assert from "node:assert/strict";
import test from "node:test";
import { ReplicaEngine, memoryStore, type Transport } from "../src/lib/replica/engine";
import { hashValue, type Manifest, type ReplicaEntity, type ReplicaOp, type ApplyAnswer } from "../src/lib/replica/shared";

/** A pretend PC: entities by key, ops applied the simple way (no conflicts), tmp ids numbered. */
function fakePc(initial: ReplicaEntity[]) {
  const ents = new Map(initial.map((e) => [e.key, structuredClone(e)]));
  let next = 1000;
  const seenOps: ReplicaOp[] = [];
  let down = false;
  const transport: Transport = async (method, path, body) => {
    if (down) throw new Error("not connected");
    if (!path.endsWith("/api/companion/replica")) throw new Error(`unexpected ${path}`);
    if (method === "GET") return { at: new Date().toISOString(), manifest: Object.fromEntries([...ents].map(([k, e]) => [k, hashValue(e.data)])) as Manifest, conflicts: [] };
    const b = body as { want?: string[]; ops?: ReplicaOp[] };
    if (b.want) return { entities: b.want.map((k) => ents.get(k as ReplicaEntity["key"])).filter(Boolean) };
    const answer: ApplyAnswer = { results: [], ids: {}, conflicts: [] };
    const ids = new Map<string, number>();
    const real = (r: unknown) => (typeof r === "string" && r.startsWith("tmp:") ? ids.get(r) : r) as number;
    for (const o of b.ops!) {
      seenOps.push(o);
      if (o.kind === "todo.add") {
        const id = next++;
        ids.set(o.tmp, id);
        answer.ids[o.tmp] = id;
        ents.set(`todo:${id}`, { key: `todo:${id}`, kind: "todo", data: { id, text: o.text, ticket: "", due: o.due ?? null, status: "open", flagged: false, deferred: false, source: null, notes: [], createdAt: o.at, updatedAt: o.at, doneAt: null } });
      } else if (o.kind === "todo.set") {
        const e = ents.get(`todo:${real(o.todo)}`)!;
        (e.data as Record<string, unknown>)[o.field] = o.value;
      }
      answer.results.push({ id: o.id, ok: true });
    }
    return answer;
  };
  return { ents, transport, seenOps, setDown: (v: boolean) => (down = v) };
}

const todo = (id: number, text: string, extra: object = {}): ReplicaEntity => ({ key: `todo:${id}`, kind: "todo", data: { id, text, ticket: "", due: null, status: "open", flagged: false, deferred: false, source: null, notes: [], createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z", doneAt: null, ...extra } });

test("first sync: everything fetched; again: only what changed, what's gone dropped", async () => {
  const pc = fakePc([todo(1, "Milch"), todo(2, "Brot")]);
  const e = new ReplicaEngine(memoryStore(), "acc");
  await e.load();
  const r1 = await e.sync(pc.transport, "");
  assert.equal(r1.fetched, 2);
  assert.deepEqual(e.list("todo").map((t) => t.text).sort(), ["Brot", "Milch"]);
  (pc.ents.get("todo:1")!.data as { text: string }).text = "Hafermilch";
  pc.ents.delete("todo:2");
  const r2 = await e.sync(pc.transport, "");
  assert.deepEqual({ fetched: r2.fetched, dropped: r2.dropped }, { fetched: 1, dropped: 1 });
  assert.deepEqual(e.list("todo").map((t) => t.text), ["Hafermilch"]);
});

test("offline: an edit shows at once and waits in the queue with what the phone saw (its base); synced later, the queue empties", async () => {
  const pc = fakePc([todo(1, "Milch")]);
  const store = memoryStore();
  const e = new ReplicaEngine(store, "acc");
  await e.load();
  await e.sync(pc.transport, "");
  pc.setDown(true);
  await e.edit({ kind: "todo.set", todo: 1, field: "status", value: "done" });
  assert.equal(e.get("todo:1")!.status, "done", "shown at once");
  assert.equal(e.pending().length, 1);
  assert.equal((e.pending()[0] as { base: string }).base, hashValue("open"), "the base is what the phone saw");
  await assert.rejects(e.sync(pc.transport, ""));
  assert.equal(e.pending().length, 1, "still queued after a failed sync");

  // The app closed and opened again: the queue and the copy are still there.
  const again = new ReplicaEngine(store, "acc");
  await again.load();
  assert.equal(again.get("todo:1")!.status, "done");
  assert.equal(again.pending().length, 1);

  pc.setDown(false);
  await again.sync(pc.transport, "");
  assert.equal(again.pending().length, 0);
  assert.equal((pc.ents.get("todo:1")!.data as { status: string }).status, "done", "on the PC");
  assert.equal(again.get("todo:1")!.status, "done");
});

test("made offline: a tmp entity at once, later edits on it queued with the tmp; after the sync the real one replaces it", async () => {
  const pc = fakePc([]);
  const e = new ReplicaEngine(memoryStore(), "acc");
  await e.load();
  const tmp = await e.edit({ kind: "todo.add", text: "Neu von unterwegs" });
  assert.match(String(tmp), /^tmp:/);
  await e.edit({ kind: "todo.set", todo: tmp!, field: "flagged", value: true });
  const shown = e.list("todo");
  assert.equal(shown.length, 1);
  assert.equal(shown[0].flagged, true);
  await e.sync(pc.transport, "");
  assert.deepEqual(pc.seenOps.map((o) => o.kind), ["todo.add", "todo.set"]);
  const after = e.list("todo");
  assert.equal(after.length, 1, "no tmp twin left");
  assert.equal(after[0].id, 1000);
});

test("two accounts don't mix: each its own copy and queue", async () => {
  const store = memoryStore();
  const a = new ReplicaEngine(store, "a");
  const b = new ReplicaEngine(store, "b");
  await a.load();
  await b.load();
  await a.edit({ kind: "todo.add", text: "nur in a" });
  await b.load();
  assert.equal(b.list("todo").length, 0);
  assert.equal(b.pending().length, 0);
});

test("the ops a sync sends carry the account's route", async () => {
  const pc = fakePc([]);
  const paths: string[] = [];
  const e = new ReplicaEngine(memoryStore(), "privat");
  await e.load();
  await e.sync((m, p, b) => (paths.push(p), pc.transport(m, p.replace("/privat", ""), b)), "/privat");
  assert.ok(paths.every((p) => p.startsWith("/privat/api/companion/replica")));
});
