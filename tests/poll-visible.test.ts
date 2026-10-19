import assert from "node:assert/strict";
import test from "node:test";
import { pollWhileVisible } from "@/lib/poll-visible";

/** A page that is looked at asks often; one in a hidden tab doesn't ask at all — and asks at once when it comes back. */
function fakeDoc(visible: boolean) {
  const listeners: (() => void)[] = [];
  const doc = {
    visibilityState: (visible ? "visible" : "hidden") as DocumentVisibilityState,
    addEventListener: (_: string, f: () => void) => void listeners.push(f),
    removeEventListener: (_: string, f: () => void) => void listeners.splice(listeners.indexOf(f), 1),
  };
  return { doc, set: (v: boolean) => ((doc.visibilityState = v ? "visible" : "hidden"), listeners.slice().forEach((f) => f())), listeners };
}
function fakeTimers() {
  const live = new Map<number, () => void>();
  let n = 0;
  return {
    timers: { setInterval: (f: () => void) => (live.set(++n, f), n as never), clearInterval: (id: never) => void live.delete(id as number) },
    tick: () => live.forEach((f) => f()),
    count: () => live.size,
  };
}

test("pollWhileVisible: ticks while visible, none while hidden, one at once when it shows again; stop cleans up", () => {
  const { doc, set, listeners } = fakeDoc(true);
  const { timers, tick, count } = fakeTimers();
  let calls = 0;
  const stop = pollWhileVisible(() => void calls++, 1000, doc, timers);
  assert.equal(count(), 1, "visible: a timer runs");
  tick();
  assert.equal(calls, 1);
  set(false);
  assert.equal(count(), 0, "hidden: no timer");
  tick();
  assert.equal(calls, 1, "nothing asked while hidden");
  set(true);
  assert.equal(calls, 2, "back in view: it asks at once");
  assert.equal(count(), 1);
  stop();
  assert.equal(count(), 0);
  assert.equal(listeners.length, 0, "the listener is gone");
});

test("pollWhileVisible: a page opened hidden starts silent", () => {
  const { doc, set } = fakeDoc(false);
  const { timers, count } = fakeTimers();
  let calls = 0;
  pollWhileVisible(() => void calls++, 1000, doc, timers);
  assert.equal(count(), 0);
  set(true);
  assert.equal(calls, 1);
  assert.equal(count(), 1);
});
