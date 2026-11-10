import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";
import { cleanReserved, SlotPool } from "@/lib/work/slots";

setupTempData();

const LEARN = "Zeff-Chat:learn";

test("without reservations the general workers are all there is", () => {
  const p = new SlotPool(2, {}, [null, "jira"]);
  assert.equal(p.free, 0);
  assert.equal(p.take(LEARN), false);
});

test("a reserved slot takes only its source's runs, on top of the general ones", () => {
  const p = new SlotPool(2, { [LEARN]: 1 }, [null, "jira"]);
  assert.equal(p.free, 1);
  assert.equal(p.freeFor(null), 0, "a Code run still waits");
  assert.equal(p.take(null), false);
  assert.equal(p.take(LEARN), true, "the lesson starts on its reserved slot");
  assert.equal(p.free, 0);
});

test("a source's runs fill its reserved slots first, then general ones", () => {
  // Two lessons running, one reserved: one sits in the reserved slot, the other holds a general one.
  const p = new SlotPool(2, { [LEARN]: 1 }, [LEARN, LEARN]);
  assert.equal(p.reservedFree(LEARN), 0);
  assert.equal(p.freeFor(null), 1);
  assert.equal(p.take(null), true);
  assert.equal(p.take(LEARN), false);
});

test("a run of the source takes its reserved slot before a general one", () => {
  const p = new SlotPool(1, { [LEARN]: 1 }, []);
  assert.equal(p.take(LEARN), true);
  assert.equal(p.freeFor(null), 1, "the general worker is still free for Code");
});

test("reservations are cleaned: numbers clamped, zero and junk dropped", () => {
  assert.deepEqual(cleanReserved({ [LEARN]: "2", x: 0, y: -3, z: 99 }), { [LEARN]: 2, z: 4 });
  assert.deepEqual(cleanReserved(null), {});
});

test("a waiting lesson stays queued while the general workers are taken; Learn's button reserves one for it", async () => {
  const { addFollowUp } = await import("@/lib/todos/store");
  const { createRun, getRun, updateRun, updateWorkSettings, reservedWorkers } = await import("@/lib/work/store");
  const { pump, reserveWorkerFor } = await import("@/lib/work/runner");
  updateWorkSettings({ parallel: 1, reserved: {} });
  const code = addFollowUp({ ticket: "ABC-1", text: "Code", kind: "other", parentId: null, workRunId: null, source: "test" });
  const lesson = addFollowUp({ ticket: "", text: "Lesson", kind: "other", parentId: null, workRunId: null, source: LEARN });
  const base = { ticket: "ABC-1", mode: "instruct", provider: "agent", model: null, permissionMode: null, repo: null, prompt: "x" };
  const busy = createRun({ ...base, todoId: code.id, provider: "claude" });
  updateRun(busy.id, { status: "running" }); // the one general worker is taken
  const waiting = createRun({ ...base, todoId: lesson.id, ticket: "", provider: "claude" });
  pump();
  assert.equal(getRun(waiting.id)!.status, "queued", "no worker free yet");
  // (Taken out of the queue before the button pumps it: a real start would launch a CLI — the decision is what's tested.)
  updateRun(waiting.id, { status: "cancelled" });
  const n = reserveWorkerFor(LEARN);
  assert.equal(n, 1);
  assert.deepEqual(reservedWorkers(), { [LEARN]: 1 });
  // Asked again while the reserved worker is free: nothing more is reserved.
  assert.equal(reserveWorkerFor(LEARN), 1);
  // A lesson holds the reserved worker: the button adds one more.
  const other = createRun({ ...base, todoId: lesson.id, ticket: "", provider: "claude" });
  updateRun(other.id, { status: "running" });
  assert.equal(reserveWorkerFor(LEARN), 2);
  assert.deepEqual(reservedWorkers(), { [LEARN]: 2 });
});
