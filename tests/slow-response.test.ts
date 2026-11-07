import assert from "node:assert/strict";
import test from "node:test";
import { slowJson } from "../src/lib/slow-response";

test("a slow answer starts at once and is still JSON, spaces and all", async () => {
  let finish: (v: unknown) => void = () => {};
  const res = slowJson(() => new Promise((r) => (finish = r)));
  const reader = res.body!.getReader();
  const first = await reader.read();
  assert.equal(new TextDecoder().decode(first.value), " ", "something goes out before the work is done");
  finish({ ok: true, hits: [1] });
  let text = " ";
  for (let c = await reader.read(); !c.done; c = await reader.read()) text += new TextDecoder().decode(c.value);
  assert.deepEqual(JSON.parse(text), { ok: true, hits: [1] });
  assert.match(res.headers.get("cache-control") ?? "", /no-transform/);
});

test("work that fails comes back as an answer, not as a broken stream", async () => {
  const text = await slowJson(() => Promise.reject(new Error("nope"))).text();
  assert.deepEqual(JSON.parse(text), { ok: false, error: "nope" });
});
