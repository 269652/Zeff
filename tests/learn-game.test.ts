import assert from "node:assert/strict";
import test from "node:test";
import { levelOf, nextStreak, badgesFor, dailyProgress } from "@/plugins/learn/game";
import { review, newCard, isDue } from "@/plugins/learn/srs";

test("levels: level 1 at 0 xp, each level needs more than the one before", () => {
  assert.deepEqual(levelOf(0), { level: 1, into: 0, need: 100, share: 0 });
  assert.equal(levelOf(99).level, 1);
  assert.equal(levelOf(100).level, 2);
  const l2 = levelOf(100).need;
  const l3 = levelOf(100 + l2).need;
  assert.ok(l3 > l2, "the curve rises");
  const mid = levelOf(150);
  assert.equal(mid.into, 50);
  assert.ok(mid.share > 0 && mid.share < 1);
});

test("streak: today again keeps it, yesterday adds a day, a gap starts over", () => {
  assert.deepEqual(nextStreak({ streak: 0, lastDay: null }, "2026-11-08"), { streak: 1, lastDay: "2026-11-08" });
  assert.deepEqual(nextStreak({ streak: 4, lastDay: "2026-11-08" }, "2026-11-08"), { streak: 4, lastDay: "2026-11-08" });
  assert.deepEqual(nextStreak({ streak: 4, lastDay: "2026-11-07" }, "2026-11-08"), { streak: 5, lastDay: "2026-11-08" });
  assert.deepEqual(nextStreak({ streak: 9, lastDay: "2026-11-05" }, "2026-11-08"), { streak: 1, lastDay: "2026-11-08" });
  assert.deepEqual(nextStreak({ streak: 3, lastDay: "2026-12-31" }, "2027-01-01"), { streak: 4, lastDay: "2027-01-01" }, "across a year");
});

test("daily goal: today's xp against the goal", () => {
  assert.deepEqual(dailyProgress(30, 50), { xp: 30, goal: 50, share: 0.6, reached: false });
  assert.equal(dailyProgress(80, 50).reached, true);
  assert.equal(dailyProgress(80, 50).share, 1, "capped at 1");
});

test("badges: earned by what happened — each once", () => {
  const none = badgesFor({ stepsMastered: 0, skillsMastered: 0, phasesMastered: 0, yearsMastered: 0, streak: 0, reviews: 0, widgets: 0, courseDone: false });
  assert.deepEqual(none, []);
  const some = badgesFor({ stepsMastered: 1, skillsMastered: 1, phasesMastered: 0, yearsMastered: 0, streak: 7, reviews: 100, widgets: 10, courseDone: false });
  assert.deepEqual(some.sort(), ["first-skill", "first-step", "reviews-100", "streak-7", "widgets-10"].sort());
  assert.ok(badgesFor({ stepsMastered: 50, skillsMastered: 9, phasesMastered: 3, yearsMastered: 1, streak: 30, reviews: 1000, widgets: 0, courseDone: true }).includes("course-done"));
});

const day = (iso: string) => new Date(`${iso}T09:00:00Z`);

test("srs: a new card answered well comes back in a day, then in ~6, then further apart", () => {
  let c = newCard(day("2026-11-08"));
  assert.ok(isDue(c, day("2026-11-08")), "a new card is due at once");
  c = review(c, "good", day("2026-11-08"));
  assert.equal(c.reps, 1);
  assert.equal(c.interval, 1);
  assert.ok(!isDue(c, day("2026-11-08")));
  assert.ok(isDue(c, day("2026-11-09")));
  c = review(c, "good", day("2026-11-09"));
  assert.equal(c.interval, 6);
  const before = c.interval;
  c = review(c, "good", day("2026-11-15"));
  assert.ok(c.interval > before * 2, "grows with the ease");
});

test("srs: 'again' starts the card over and makes it harder; 'easy' goes further than 'good'", () => {
  let c = review(review(newCard(day("2026-11-08")), "good", day("2026-11-08")), "good", day("2026-11-09"));
  const ease = c.ease;
  const lapsed = review(c, "again", day("2026-11-15"));
  assert.equal(lapsed.reps, 0);
  assert.equal(lapsed.lapses, 1);
  assert.equal(lapsed.interval, 0, "again: due again the same day");
  assert.ok(lapsed.ease < ease);
  assert.ok(lapsed.ease >= 1.3, "never below 1.3");
  const good = review(c, "good", day("2026-11-15"));
  const easy = review(c, "easy", day("2026-11-15"));
  const hard = review(c, "hard", day("2026-11-15"));
  assert.ok(easy.interval > good.interval && good.interval > hard.interval);
  c = lapsed;
  for (let i = 0; i < 20; i++) c = review(c, "again", day("2026-11-15"));
  assert.ok(c.ease >= 1.3);
});
