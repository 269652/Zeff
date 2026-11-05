import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { IdleWrites, type HeldEdits } from "@/plugins/workspace/ui/idle-writes";

const setup = () => {
  const written: [number, string, unknown][] = [];
  let shown: HeldEdits = {};
  const w = new IdleWrites((r, p, v) => written.push([r, p, v]), (e) => (shown = e), 800);
  return { w, written, shown: () => shown };
};

test("a value stepped down is shown at once and written once, where it ended, when nothing happened for a while", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const { w, written, shown } = setup();
  for (const [i, day] of ["10:03", "10:02", "10:01"].entries()) {
    w.hold(1, "time", day);
    assert.equal(shown()[1].time, day, `step ${i} shows`);
    mock.timers.tick(500);
  }
  assert.deepEqual(written, [], "still going: nothing written");
  mock.timers.tick(300);
  assert.deepEqual(written, [[1, "time", "10:01"]]);
  assert.deepEqual(shown(), {}, "written, the row shows it again");
  mock.timers.tick(5000);
  assert.equal(written.length, 1);
  mock.timers.reset();
});

test("another field keeps the wait going, and both are written together; flush doesn't wait; dropped isn't written", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const { w, written, shown } = setup();
  w.hold(1, "time", "a");
  mock.timers.tick(700);
  w.hold(2, "dose", 5);
  mock.timers.tick(700);
  assert.deepEqual(written, []);
  assert.deepEqual(shown(), { 1: { time: "a" }, 2: { dose: 5 } });
  mock.timers.tick(100);
  assert.deepEqual(written, [[1, "time", "a"], [2, "dose", 5]]);

  written.length = 0;
  w.hold(3, "time", "b");
  w.flush();
  assert.deepEqual(written, [[3, "time", "b"]], "at once");
  w.flush();
  mock.timers.tick(5000);
  assert.equal(written.length, 1, "only once");

  written.length = 0;
  w.hold(4, "time", "c");
  w.drop(4, "time");
  assert.deepEqual(shown(), {});
  mock.timers.tick(5000);
  assert.deepEqual(written, []);
  mock.timers.reset();
});
