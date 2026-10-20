import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/** Two plugins' queues — one of them async — and a link to a page of its own. */
async function contribute() {
  const { reviewSources, reviewLinks } = await import("@/lib/review/point");
  const acted: string[] = [];
  reviewSources.contribute("core", [
    {
      id: "test-a",
      label: "Kind A",
      list: () => [{ id: "1", title: "First", detail: "why one", confidence: 0.9, href: "/a/1", actions: [{ id: "yes", label: "Right", primary: true }, { id: "no", label: "Wrong" }] }],
      act: (id, action) => void acted.push(`a:${id}:${action}`),
    },
  ]);
  reviewSources.contribute("zeiterfassung", [
    {
      id: "test-b",
      label: "Kind B",
      list: async () => [{ id: "x:7", title: "Second", actions: [{ id: "done", label: "Done", primary: true }] }],
      act: async (id, action) => {
        acted.push(`b:${id}:${action}`);
        return "Done ✓";
      },
    },
    { id: "test-broken", label: "Broken", list: () => { throw new Error("boom"); }, act: () => {} },
  ]);
  reviewLinks.contribute("zeiterfassung", [{ id: "test-link", label: "Booking suggestions", href: "/", count: () => 3 }]);
  return acted;
}

test("the queue: every contribution's items, keyed by their source, with its kind; a failing source is named, not fatal", async () => {
  await contribute();
  const { reviewItems } = await import("@/lib/review");
  const q = await reviewItems();
  const ours = q.items.filter((i) => i.key.startsWith("test-"));
  assert.deepEqual(
    ours.map((i) => [i.key, i.kind, i.title]),
    [
      ["test-a:1", "Kind A", "First"],
      ["test-b:x:7", "Kind B", "Second"],
    ],
  );
  assert.equal(ours[0].detail, "why one");
  assert.equal(ours[0].href, "/a/1");
  assert.equal(ours[0].actions[0].primary, true);
  assert.deepEqual(q.errors.map((e) => [e.source, e.message]), [["test-broken", "boom"]]);
  assert.deepEqual(q.links.find((l) => l.id === "test-link"), { id: "test-link", label: "Booking suggestions", href: "/", count: 3 });
});

test("acting: the key leads to its source, with the item's own id (colons and all); an unknown key is an error", async () => {
  const acted = await contribute();
  const { reviewAct } = await import("@/lib/review");
  assert.deepEqual(await reviewAct("test-a:1", "no"), {});
  assert.deepEqual(await reviewAct("test-b:x:7", "done"), { message: "Done ✓" });
  assert.deepEqual(acted, ["a:1:no", "b:x:7:done"]);
  await assert.rejects(() => reviewAct("nope:1", "yes"), /nope:1/);
  await assert.rejects(() => reviewAct("test-a", "yes"), /test-a/);
});

test("count: how many wait in the queue and on the linked pages", async () => {
  await contribute();
  const { reviewItems } = await import("@/lib/review");
  const q = await reviewItems();
  assert.equal(q.count, q.items.length + q.links.reduce((n, l) => n + l.count, 0));
});
