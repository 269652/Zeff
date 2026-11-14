import assert from "node:assert/strict";
import test from "node:test";

/** View exercises: a <subview> draws a template with its own state and a report button that carries where the result goes. */
const draw = async (src: string, app: Record<string, unknown> = {}) => {
  const { renderView } = await import("@/plugins/workspace/view-template");
  return renderView(src, { rows: [], props: [], titleName: "Name", state: {}, app, data: {}, db: { id: 1, title: "X" } });
};
const find = (nodes: unknown[], t: string): { t: string; a: Record<string, string>; c: unknown[] } | null => {
  for (const n of nodes) {
    if (!n || typeof n !== "object") continue;
    const x = n as { t: string; a: Record<string, string>; c: unknown[] };
    if (x.t === t) return x;
    const deep = find(x.c ?? [], t);
    if (deep) return deep;
  }
  return null;
};

test("the guide's example draws without mistakes, and its report button carries the subview's target", async () => {
  const { VIEW_EXERCISE_GUIDE } = await import("@/lib/widgets/view-exercise-guide");
  const example = VIEW_EXERCISE_GUIDE.split("BEISPIEL:\n")[1];
  const r = await draw(`<subview template="{{ app.v }}" report="learn.result" with="exercise=7" kind="Übung"/>`, { v: example });
  assert.deepEqual(r.errors, []);
  const sv = find(r.nodes, "subview");
  assert.ok(sv);
  const btn = find(sv!.c, "button");
  assert.equal(btn?.a.report, "learn.result");
  assert.equal(btn?.a.with, "exercise=7");
  assert.equal(btn?.a.total, "1");
});

test("a report button outside a subview is a mistake; mistakes inside one say so", async () => {
  const outside = await draw(`<button action="report" score="1" label="Go"/>`);
  assert.ok(outside.errors.some((e) => /subview/.test(e.message)));
  const inside = await draw(`<subview template="{{ app.v }}"/>`, { v: "<nonsense/>" });
  assert.ok(inside.errors.some((e) => /^<subview> line 1/.test(e.message)));
});
