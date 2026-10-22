import assert from "node:assert/strict";
import test from "node:test";
import { appointmentsAllowed, placeAppointment, PRIVATE_WINDOW } from "../src/plugins/auto-actions/placing";

const at = (s: string) => new Date(`${s}:00`);
const tomorrow = () => {
  const d = new Date(Date.now() + 864e5);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

test("at most three suggested appointments a day: the fourth goes to the next day with room, at the time it asked for", () => {
  const day = tomorrow();
  const taken: { start: Date; end: Date }[] = [];
  const starts = [0, 1, 2, 3, 4].map(() => placeAppointment(`${day}T09:00`, 30, [], taken, PRIVATE_WINDOW, 3));
  assert.deepEqual(starts.slice(0, 3).map((s) => s.slice(0, 10)), [day, day, day], "three on the day asked for");
  const next = starts[3].slice(0, 10);
  assert.notEqual(next, day, "the fourth on another day");
  assert.equal(starts[3].slice(11), "09:00", "at the time it asked for");
  assert.equal(starts[4].slice(0, 10), next, "the fifth beside it — that day has room");
  assert.equal(new Set(starts).size, 5, "none on top of another");
});

test("the day's count includes the suggestions placed before (other todos'), and what is busy is avoided", () => {
  const day = tomorrow();
  const taken = [at(`${day}T08:00`), at(`${day}T12:00`), at(`${day}T16:00`)].map((s) => ({ start: s, end: new Date(s.getTime() + 30 * 60000) }));
  const s = placeAppointment(`${day}T10:00`, 30, [], taken, PRIVATE_WINDOW, 3);
  assert.notEqual(s.slice(0, 10), day, "that day is full already");
});

test("no appointment suggestions for an agent's follow-ups — a person's todos keep theirs", () => {
  assert.equal(appointmentsAllowed({ source: "Follow-up from W-59" }), false);
  assert.equal(appointmentsAllowed({ source: "Planned after T-40" }), false);
  assert.equal(appointmentsAllowed({ source: "Mail-Durchsicht" }), true);
  assert.equal(appointmentsAllowed({ source: "Karte KB-4" }), true);
});
