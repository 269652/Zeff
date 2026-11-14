import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { setupTempData } from "./helpers";
import { repoPlugin, skipWithoutRepo } from "./plugins-repo";

setupTempData();

/**
 * The Learn page's overview as blocks of its own: a heading, a figure tile (which figure: a parameter), XP per day, cards by stack and
 * one line per course — each picked, moved, set and changed on its own on the page, side by side in rows. They all read the same flow
 * (learn.dashboard), asked once for all of them. learn.overview stays, made of them: pages that use it stay as they are.
 */

type Def = { name: string; params: { name: string; options?: string[] }[]; template: string; example?: string };
type DocNode = { type: string; attrs?: Record<string, unknown>; content?: DocNode[] };
const SKIP = skipWithoutRepo("learn");
const pkg = (SKIP ? { items: [], blocks: [] } : JSON.parse(fs.readFileSync(`${repoPlugin("learn")}/learn.package.json`, "utf8"))) as { items: { id: string; content?: DocNode }[]; blocks: { def: Def }[] };
const defs = pkg.blocks.map((b) => b.def);

const sample = {
  totals: { mastered: 3, steps: 10, percent: 30, begun: 2, due: 5, cards: 40, knownPercent: 25, known: 10, streak: 4, todayXp: 30, todayPercent: 60, dailyGoal: 50, week: 120, weekTrend: -7, exercisesDone: 2, exercises: 6, avgBest: 80, triesWeek: 3, level: 2, xp: 900, ready: 1, courses: 1 },
  last14: [1, 2, 3],
  days: [{ day: "2026-11-01", xp: 20 }],
  stacks: [{ box: 1, n: 30 }, { box: 4, n: 10 }],
  courses: [{ title: "Linear algebra", status: "ready", level: 2, xp: 900, streak: 4, due: 5, percent: 30, mastered: 3, steps: 10, cards: 40, todayXp: 30, dailyGoal: 50 }],
};

const text = (n: unknown): string => (typeof n === "string" ? n : n && typeof n === "object" ? [...Object.values((n as { a?: Record<string, string> }).a ?? {}), ...((n as { c?: unknown[] }).c ?? []).map(text)].join(" ") : "");

async function draw(src: string, data: Record<string, unknown> = {}) {
  const { renderView } = await import("@/plugins/workspace/view-template");
  const r = renderView(src, { rows: [], props: [], titleName: "Name", state: {}, app: {}, data, db: { id: 1, title: "Learn" } }, { blocks: defs as never });
  return { errors: r.errors, text: r.nodes.map(text).join(" ").replace(/\s+/g, " ") };
}

test("every Learn block holds, saved as the package brings them (its parts before the overview), and its example draws without a mistake", { skip: SKIP }, async () => {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("workspace", true);
  const { checkBlock } = await import("@/plugins/workspace/block-check");
  const { saveBlock } = await import("@/plugins/workspace/block-store");
  for (const d of defs) {
    assert.deepEqual(checkBlock(d).errors, [], d.name);
    saveBlock(d as never, { source: "package", note: "Learn" });
    assert.deepEqual((await draw(d.example ?? "")).errors, [], d.name);
  }
});

test("a figure tile shows the figure its parameter names, from the flow's answer; loading, a placeholder", { skip: SKIP }, async () => {
  const stat = defs.find((d) => d.name === "learn.stat")!;
  const metrics = stat.params.find((p) => p.name === "metric")!.options!;
  assert.deepEqual(metrics, ["steps", "due", "known", "streak", "xp-today", "xp-week", "exercises", "level"]);
  // (A page draws one <use> per block: its data is the block's own, data.dash under its prefix.)
  const due = await draw('<use block="learn.stat" metric="due"/>', { _learn_stat0_dash: sample });
  assert.deepEqual(due.errors, []);
  assert.match(due.text, /Cards due today/);
  assert.match(due.text, /🃏 5 of 40 cards/);
  assert.doesNotMatch(due.text, /Streak/);
  assert.match((await draw('<use block="learn.stat" metric="xp-week"/>', { _learn_stat0_dash: sample })).text, /▼ 7 on the week before/);
  assert.doesNotMatch((await draw('<use block="learn.stat" metric="due"/>')).text, /Cards due today/, "not loaded yet: no figure");
  assert.ok((await draw('<use block="learn.stat" metric="nope"/>')).errors.length > 0, "a figure it does not know is a mistake");
  const lines = await draw('<use block="learn.course-lines"/>', { _learn_course_lines0_dash: sample });
  assert.match(lines.text, /Linear algebra/);
});

test("the Learn page lays the overview out as blocks in rows; learn.overview stays, made of them", { skip: SKIP }, async () => {
  const page = pkg.items.find((i) => i.id === "i1")!.content!;
  const used: { block: string; params: Record<string, string> }[] = [];
  const walk = (n: DocNode) => {
    if (n.type === "zeffBlock") used.push({ block: String(n.attrs!.block), params: JSON.parse(String(n.attrs!.params)) });
    n.content?.forEach(walk);
  };
  walk(page);
  assert.deepEqual(
    used.map((u) => `${u.block}${u.params.metric ? `:${u.params.metric}` : ""}`),
    ["learn.header", "learn.stat:steps", "learn.stat:due", "learn.stat:known", "learn.stat:streak", "learn.stat:xp-today", "learn.stat:xp-week", "learn.stat:exercises", "learn.stat:level", "learn.xp-days", "learn.stacks", "learn.course-lines"],
  );
  for (const u of used) assert.ok(defs.some((d) => d.name === u.block), `${u.block} comes with the package`);
  const rows = page.content!.filter((n) => n.type === "flexBox");
  assert.deepEqual(rows.map((r) => r.content!.length), [4, 4, 2], "two rows of four tiles, then the heatmap beside the stacks");
  // (Kept as it is by a page's save.)
  const { sanitizeDoc } = await import("@/plugins/workspace/doc");
  assert.deepEqual(sanitizeDoc(page as never).content!.filter((n) => n.type === "flexBox").length, 3);

  const overview = defs.find((d) => d.name === "learn.overview")!;
  for (const b of ["learn.header", "learn.stat", "learn.xp-days", "learn.stacks", "learn.course-lines"]) assert.ok(overview.template.includes(`<use block="${b}"`), b);
  assert.deepEqual((await draw('<use block="learn.overview"/>')).errors, []);
});
