import assert from "node:assert/strict";
import test from "node:test";
import {
  activeMinutes,
  arrivalGaps,
  baselineOf,
  historyBaseline,
  judgeStep,
  trackIncidents,
  weekendsQuiet,
  type StepInput,
} from "@/lib/sync/source-health-shared";

/** Local times (the quiet hours and weekends are the PC's local ones). 2026-10-19 is a Monday. */
const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).getTime();
const WORK = { quiet: { from: 19, to: 8 }, weekends: false };
const ALWAYS = { quiet: { from: 19, to: 8 }, weekends: true };

test("the dates the tests use fall as they assume", () => {
  assert.equal(new Date(at(19, 9)).getDay(), 1, "19 Oct 2026 is a Monday");
});

test("active minutes leave out the quiet hours, and the weekends for a workday source", () => {
  // Friday 18:00 → Monday 09:00: an hour on Friday, one on Monday.
  assert.equal(activeMinutes(at(16, 18), at(19, 9), WORK), 120);
  // With the weekend's days (08–19 each): 60 + 2 × 660 + 60.
  assert.equal(activeMinutes(at(16, 18), at(19, 9), ALWAYS), 1440);
  // Inside one day.
  assert.equal(activeMinutes(at(20, 10), at(20, 12, 30), WORK), 150);
  // A day off (vacation) counts nothing.
  assert.equal(activeMinutes(at(20, 10), at(21, 10), { ...WORK, skipDays: new Set(["2026-10-21"]) }), 540);
  // The wrong way round: nothing.
  assert.equal(activeMinutes(at(20, 12), at(20, 10), WORK), 0);
});

/** Teams-like: something every half hour on workdays 09:00–16:30, nothing at the weekend — four weeks up to `until`. */
function workdayHistory(until: number): number[] {
  const out: number[] = [];
  for (let d = new Date(2026, 8, 21); d.getTime() < until; d.setDate(d.getDate() + 1)) {
    if (d.getDay() === 0 || d.getDay() === 6) continue;
    for (let m = 9 * 60; m <= 16 * 60 + 30; m += 30) {
      const t = new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(m / 60), m % 60).getTime();
      if (t < until) out.push(t);
    }
  }
  return out;
}

test("a workday source's history says its weekends are quiet; a chat's doesn't", () => {
  assert.equal(weekendsQuiet(workdayHistory(at(17, 0))), true);
  const chat: number[] = [];
  for (let d = 1; d <= 18; d++) for (const h of [9, 13, 18]) chat.push(new Date(2026, 9, d, h).getTime());
  assert.equal(weekendsQuiet(chat), false);
  assert.equal(weekendsQuiet([at(14, 9), at(15, 9)]), false, "too little to tell: weekends count");
});

test("the baseline: the usual gaps between arrivals, robust to the long ones — none from too little history", () => {
  const gaps = arrivalGaps(workdayHistory(at(17, 0)), WORK);
  // Within a day 30 min; overnight and over the weekend the same 210 active minutes (16:30–19:00, 08:00–09:00).
  assert.ok(gaps.every((g) => g === 30 || g === 210), `unexpected gaps ${[...new Set(gaps)]}`);
  const b = historyBaseline(workdayHistory(at(17, 0)), WORK, 120)!;
  assert.equal(b.medianMin, 30);
  assert.ok(b.thresholdMin >= 210, "the usual overnight gap is never an alarm");
  assert.equal(baselineOf([30, 30, 30], 120), null, "a handful of gaps: no verdict");
  // Arrivals within a few minutes are one.
  assert.deepEqual(arrivalGaps([at(20, 10), at(20, 10, 2), at(20, 11)], WORK), [60]);
});

const step = (over: Partial<StepInput> = {}): StepInput => ({
  key: "teams",
  label: "Teams",
  href: "/teams",
  everyMinutes: 15,
  workdays: false,
  quietHours: true,
  chained: false,
  running: false,
  lastAt: null,
  lastOk: null,
  lastMessage: null,
  failures: 0,
  failingSince: null,
  lastOkAt: null,
  drift: null,
  arrivals: null,
  skipDays: undefined,
  ...over,
});

test("Monday morning after a quiet weekend: no false alarm; the same quiet on a Wednesday: silent", () => {
  const history = workdayHistory(at(16, 17)); // up to Friday 16:30
  const monday = judgeStep(step({ arrivals: history, lastAt: new Date(at(19, 8, 25)).toISOString(), lastOk: true, lastOkAt: new Date(at(19, 8, 25)).toISOString() }), { now: at(19, 8, 30), upSince: at(1, 0) });
  assert.equal(monday.state, "ok", JSON.stringify(monday.detail));

  // Up to Tuesday 10:00, then nothing though the runs go on till Wednesday noon.
  const tuesday = [...workdayHistory(at(16, 17)), at(19, 9), at(19, 12), at(19, 16), at(20, 9), at(20, 10)];
  const wed = judgeStep(step({ arrivals: tuesday, lastAt: new Date(at(21, 11, 55)).toISOString(), lastOk: true, lastOkAt: new Date(at(21, 11, 55)).toISOString() }), { now: at(21, 12), upSince: at(1, 0) });
  assert.equal(wed.state, "silent");
  assert.equal(wed.detail.kind, "silent");
  assert.equal(wed.lastNewAt, new Date(at(20, 10)).toISOString());
});

test("silent only while runs went through: no run since the last item is not silence of the source", () => {
  const tuesday = [...workdayHistory(at(16, 17)), at(20, 10)];
  // The last good run right after the last item — the PC was off since; the Zeff server just came up.
  const h = judgeStep(step({ arrivals: tuesday, lastAt: new Date(at(20, 10, 5)).toISOString(), lastOk: true, lastOkAt: new Date(at(20, 10, 5)).toISOString() }), { now: at(21, 12), upSince: at(21, 11, 58) });
  assert.equal(h.state, "ok");
});

test("too little history: never silent", () => {
  const h = judgeStep(step({ arrivals: [at(1, 10), at(2, 10), at(3, 10)], lastAt: new Date(at(21, 11)).toISOString(), lastOk: true, lastOkAt: new Date(at(21, 11)).toISOString() }), { now: at(21, 12), upSince: at(1, 0) });
  assert.equal(h.state, "ok");
});

test("failing beats everything; stale when no run came though one was due; a server that just started isn't stale", () => {
  const failing = judgeStep(step({ lastAt: new Date(at(21, 10)).toISOString(), lastOk: false, lastMessage: "Failed to fetch", failures: 3, failingSince: new Date(at(21, 8)).toISOString() }), { now: at(21, 12), upSince: at(1, 0) });
  assert.equal(failing.state, "failing");
  assert.equal(failing.since, new Date(at(21, 8)).toISOString());

  const blip = judgeStep(step({ lastAt: new Date(at(21, 11, 50)).toISOString(), lastOk: false, failures: 1, failingSince: new Date(at(21, 11, 50)).toISOString() }), { now: at(21, 12), upSince: at(1, 0) });
  assert.equal(blip.state, "ok", "failed once: a blip");

  // Every 15 min, last run Tuesday 16:00, now Wednesday 12:00 — the server ran all the while.
  const stale = judgeStep(step({ lastAt: new Date(at(20, 16)).toISOString(), lastOk: true, lastOkAt: new Date(at(20, 16)).toISOString() }), { now: at(21, 12), upSince: at(1, 0) });
  assert.equal(stale.state, "stale");
  assert.equal(stale.detail.kind, "stale");

  const fresh = judgeStep(step({ lastAt: new Date(at(20, 16)).toISOString(), lastOk: true }), { now: at(21, 12), upSince: at(21, 11, 50) });
  assert.equal(fresh.state, "ok", "the server came up ten minutes ago: its scheduler is just starting");

  const handOnly = judgeStep(step({ everyMinutes: 0, lastAt: new Date(at(1, 16)).toISOString(), lastOk: true }), { now: at(21, 12), upSince: at(1, 0) });
  assert.equal(handOnly.state, "ok", "only by hand: never stale");

  // A workday step on Monday morning: the weekend doesn't count.
  const monday = judgeStep(step({ key: "boards", workdays: true, everyMinutes: 60, lastAt: new Date(at(16, 18, 30)).toISOString(), lastOk: true }), { now: at(19, 9), upSince: at(1, 0) });
  assert.equal(monday.state, "ok");

  // A step that runs with the briefing: its staleness is the briefing's.
  const chained = judgeStep(step({ key: "mailtodos", chained: true, lastAt: new Date(at(10, 16)).toISOString(), lastOk: true }), { now: at(21, 12), upSince: at(1, 0) });
  assert.equal(chained.state, "ok");

  const running = judgeStep(step({ running: true, lastAt: new Date(at(20, 16)).toISOString(), lastOk: false, failures: 5, failingSince: new Date(at(20, 8)).toISOString() }), { now: at(21, 12), upSince: at(1, 0) });
  assert.equal(running.state, "ok", "running right now: its run may be fixing it");
});

test("drift: the app no longer matches the driver's contract (its last check said so)", () => {
  const h = judgeStep(step({ key: "whatsapp", lastAt: new Date(at(21, 11, 55)).toISOString(), lastOk: true, lastOkAt: new Date(at(21, 11, 55)).toISOString(), drift: { ok: false, summary: "missing: module load", at: new Date(at(21, 9)).toISOString() } }), { now: at(21, 12), upSince: at(1, 0) });
  assert.equal(h.state, "drift");
  assert.equal(h.since, new Date(at(21, 9)).toISOString());
});

test("far fewer than usual: silent too (the source still brings a little)", () => {
  // Thirty a day for three weeks, then two a day on the last two workdays.
  const items: number[] = [];
  for (let d = new Date(2026, 8, 28); d.getTime() < at(20, 0); d.setDate(d.getDate() + 1)) {
    if (d.getDay() === 0 || d.getDay() === 6) continue;
    for (let i = 0; i < 30; i++) items.push(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 9, i * 15).getTime());
  }
  items.push(at(20, 9), at(20, 15), at(21, 9), at(21, 15), at(22, 9, 30));
  const h = judgeStep(step({ arrivals: items, lastAt: new Date(at(22, 10)).toISOString(), lastOk: true, lastOkAt: new Date(at(22, 10)).toISOString() }), { now: at(22, 10, 5), upSince: at(1, 0) });
  assert.equal(h.state, "silent");
  assert.equal(h.detail.kind, "thin");
});

test("an incident is told once: the same state again isn't new; over and back is; another state is", () => {
  const now = (h: number) => new Date(at(21, h)).toISOString();
  let r = trackIncidents({}, [{ key: "whatsapp", state: "silent" }, { key: "teams", state: "ok" }], now(9));
  assert.deepEqual(r.opened, ["whatsapp"]);
  assert.equal(r.next.whatsapp.openedAt, now(9));
  assert.equal(r.next.teams, undefined);

  r = trackIncidents(r.next, [{ key: "whatsapp", state: "silent" }], now(10));
  assert.deepEqual(r.opened, [], "still the same incident");
  assert.equal(r.next.whatsapp.openedAt, now(9));

  r = trackIncidents(r.next, [{ key: "whatsapp", state: "failing" }], now(11));
  assert.deepEqual(r.opened, ["whatsapp"], "worse: a new incident");

  r = trackIncidents(r.next, [{ key: "whatsapp", state: "ok" }], now(12));
  assert.deepEqual(r.next, {}, "fine again: closed");

  r = trackIncidents(r.next, [{ key: "whatsapp", state: "failing" }], now(13));
  assert.deepEqual(r.opened, ["whatsapp"], "back again: a new one");
  assert.equal(r.next.whatsapp.openedAt, now(13));
});
