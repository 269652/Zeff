import assert from "node:assert/strict";
import test from "node:test";
import { setupOnce } from "../src/lib/setup-once";

test("work a page needs done once: once per key, again when its time is up; one that failed is tried again", async () => {
  let n = 0;
  const work = () => void n++;
  await setupOnce("a", work, 50);
  await setupOnce("a", work, 50);
  assert.equal(n, 1, "once");
  await setupOnce("b", work, 50);
  assert.equal(n, 2, "another key: its own");
  await new Promise((r) => setTimeout(r, 70));
  await setupOnce("a", work, 50);
  assert.equal(n, 3, "again when its time is up");
  let tries = 0;
  await assert.rejects(setupOnce("c", () => (tries++, Promise.reject(new Error("down")))));
  await setupOnce("c", () => void tries++);
  assert.equal(tries, 2, "a failure isn't kept");
  // Two at once: the second waits for the first, it doesn't run it twice.
  let m = 0;
  await Promise.all([setupOnce("d", async () => (await new Promise((r) => setTimeout(r, 20)), m++)), setupOnce("d", () => void m++)]);
  assert.equal(m, 1);
});
