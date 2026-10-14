import assert from "node:assert/strict";
import test from "node:test";
import type { SessionItem, SessionTicket } from "../src/lib/work/sessions";
import { groupSessions, priorityOf } from "../src/components/work/session-groups";

const NOW = new Date(2026, 9, 14, 15, 0, 0).getTime(); // Wed 14 Oct 2026, 15:00 local
const at = (daysAgo: number, hour = 9) => new Date(2026, 9, 14 - daysAgo, hour, 0, 0).toISOString();

let n = 0;
const session = (title: string, when: string, extra: Partial<SessionItem> = {}): SessionItem => ({ id: ++n, ref: `W-${n}`, status: "done", live: false, waiting: false, provider: "claude", title, at: when, todoId: n, branch: null, archived: false, ...extra });
const ticket = (key: string, sessions: SessionItem[], summary: string | null = null): SessionTicket => ({ ticket: key, summary, status: null, url: null, openTodos: 0, sessions, active: false, lastAt: "" });

const tickets = [
  ticket("PROJ-454", [session("Links absolut machen", at(0, 8)), session("Kategorienbaum", at(3))], "Kategorien"),
  ticket("PROJ-306", [session("Typografie-Tokens", at(1)), session("Aufräumen", at(20), { status: "failed" })], "Schriften"),
  ticket("ABC-9", [session("Antwort entwerfen", at(0, 14), { waiting: true, live: true, status: "running" }), session("Alte Sache", at(40))]),
];

const titles = (g: ReturnType<typeof groupSessions>) => g.map((x) => x.rows.map((r) => r.title));

test("newest: by time under Today / Yesterday / Previous 7 days / Earlier — and without headings until the page is mounted", () => {
  const g = groupSessions(tickets, "newest", NOW);
  assert.deepEqual(g.map((x) => x.id), ["today", "yesterday", "week", "older"]);
  assert.deepEqual(titles(g), [["Antwort entwerfen", "Links absolut machen"], ["Typografie-Tokens"], ["Kategorienbaum"], ["Aufräumen", "Alte Sache"]]);
  const unmounted = groupSessions(tickets, "newest", null);
  assert.deepEqual(unmounted.map((x) => x.id), ["all"]);
  assert.equal(unmounted[0].rows.length, 6);
  assert.equal(unmounted[0].rows[0].title, "Antwort entwerfen");
});

test("priority: what needs you, then what works, what failed, the rest — newest first inside; empty groups are left out", () => {
  const g = groupSessions(tickets, "priority", NOW);
  assert.deepEqual(g.map((x) => x.id), ["waiting", "attention", "other"]);
  assert.deepEqual(titles(g), [["Antwort entwerfen"], ["Aufräumen"], ["Links absolut machen", "Typografie-Tokens", "Kategorienbaum", "Alte Sache"]]);
  assert.deepEqual([priorityOf({ waiting: false, live: false, status: "running" }), priorityOf({ waiting: false, live: true, status: "done" }), priorityOf({ waiting: false, live: false, status: "interrupted" }), priorityOf({ waiting: true, live: true, status: "running" })], [1, 1, 2, 0]);
});

test("ticket: a group per ticket in key order, newest first inside, the ticket and its summary on the group", () => {
  const g = groupSessions(tickets, "ticket", NOW);
  assert.deepEqual(g.map((x) => x.ticket), ["ABC-9", "PROJ-306", "PROJ-454"]);
  assert.deepEqual(titles(g), [["Antwort entwerfen", "Alte Sache"], ["Typografie-Tokens", "Aufräumen"], ["Links absolut machen", "Kategorienbaum"]]);
  assert.equal(g[1].summary, "Schriften");
  assert.ok(g.every((x) => x.id === "ticket" && x.key === `ticket:${x.ticket}`));
});

test("alphabetical: by title (numbers as numbers, case ignored), one list", () => {
  const t = [ticket("X-1", [session("zeta", at(0)), session("Alpha 10", at(1)), session("alpha 9", at(2))])];
  const g = groupSessions(t, "alpha", NOW);
  assert.equal(g.length, 1);
  assert.deepEqual(g[0].rows.map((r) => r.title), ["alpha 9", "Alpha 10", "zeta"]);
});

test("no sessions: no groups; a session without a ticket sorts last among the tickets", () => {
  assert.deepEqual(groupSessions([], "newest", NOW), []);
  const g = groupSessions([ticket("", [session("Ohne Ticket", at(0))]), ticket("A-1", [session("Mit Ticket", at(1))])], "ticket", NOW);
  assert.deepEqual(g.map((x) => x.ticket), ["A-1", ""]);
});
