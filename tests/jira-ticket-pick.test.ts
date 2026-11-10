import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/** "Find tickets for me" on a mirrored Jira board: which columns are ready/done, who is you, which tickets in which order. */

test("column stages: Ready by name (not Ready for QA), done by name or the last column, backlog left of Ready, the rest active", async () => {
  const { columnStages } = await import("@/plugins/jira-lage/pick");
  assert.deepEqual(
    columnStages([{ name: "Backlog" }, { name: "Ready for Dev" }, { name: "In Progress" }, { name: "Ready for QA" }, { name: "In Review" }, { name: "Done" }]),
    ["backlog", "ready", "active", "active", "active", "done"],
  );
  // German names, the last column done by its group (to-workspace.ts), a column left of Ready is backlog.
  assert.deepEqual(columnStages([{ name: "Ideen", group: "todo" }, { name: "Neu", group: "doing" }, { name: "Bereit", group: "doing" }, { name: "In Arbeit", group: "doing" }, { name: "Abnahme", group: "done" }]), ["backlog", "backlog", "ready", "active", "done"]);
  // No Ready column: "Selected for development", then "To Do".
  assert.deepEqual(columnStages([{ name: "Backlog" }, { name: "Selected for Development" }, { name: "In Progress" }, { name: "Done" }]), ["backlog", "ready", "active", "done"]);
  assert.deepEqual(columnStages([{ name: "To Do" }, { name: "In Progress" }, { name: "Closed" }]), ["ready", "active", "done"]);
  // None of those: the first column that isn't backlog or done.
  assert.deepEqual(columnStages([{ name: "Backlog" }, { name: "Planned" }, { name: "Doing" }, { name: "Finished", group: "done" }]), ["backlog", "ready", "active", "done"]);
  assert.deepEqual(columnStages([{ name: "READY" }, { name: "wip" }, { name: "Resolved" }]), ["ready", "active", "done"]);
});

test("isMe: case, accents and umlauts, Last-First, an e-mail's or login's name part — not someone else", async () => {
  const { isMe } = await import("@/plugins/jira-lage/pick");
  assert.equal(isMe("Moritz Rößler", ["moritz roessler"]), true);
  assert.equal(isMe("Roessler, Moritz", ["Moritz Roessler"]), true);
  assert.equal(isMe("Moritz Roessler", ["moritz.roessler@example.com"]), true);
  assert.equal(isMe("Moritz Roessler", ["Anna Roessler"]), false);
  assert.equal(isMe("", ["Moritz Roessler"]), false);
  assert.equal(isMe("Moritz Roessler", []), false);
  // Only a login known: first letter + last name.
  assert.equal(isMe("Moritz Roessler", ["mroessler"]), true);
  // …but not once a display name is known (it decides).
  assert.equal(isMe("Max Roessler", ["mroessler", "Moritz Roessler"]), false);
});

test("priority ranks: Blocker first, Lowest last, unknown in the middle", async () => {
  const { priorityRank } = await import("@/plugins/jira-lage/pick");
  assert.deepEqual(["Blocker", "Highest", "High", "Medium", "", "Low", "Lowest", "Trivial", "Hoch", "Niedrig"].map(priorityRank), [0, 1, 2, 3, 3, 4, 5, 5, 2, 4]);
});

const COLS = [{ name: "Backlog" }, { name: "Ready" }, { name: "In Progress" }, { name: "In Review" }, { name: "Done", group: "done" as const }];
let n = 0;
const tk = (key: string, column: number, assignee = "", priority = "Medium", extra: Record<string, string> = {}) => ({ id: ++n, key, title: `Title ${key}`, status: COLS[column].name, column, assignee, priority, type: extra.type ?? "Story", updated: extra.updated ?? "", url: "", order: n });

test("for me: your unfinished tickets first (nearest to done first), then Ready's unassigned or yours — yours first, by priority, then rank", async () => {
  const { pickTickets, pickedIds } = await import("@/plugins/jira-lage/pick");
  n = 0;
  const tickets = [
    tk("P-1", 0, ""), // backlog: out
    tk("P-2", 1, "", "Low"),
    tk("P-3", 1, "Anna Other"), // someone else's in Ready: out
    tk("P-4", 1, "", "High"),
    tk("P-5", 1, "Moritz Roessler", "Low"), // yours in Ready: first of Ready
    tk("P-6", 2, "Moritz Roessler"),
    tk("P-7", 3, "moritz.roessler@example.com"), // in review: nearest to done
    tk("P-8", 2, "Anna Other"), // others' work: out
    tk("P-9", 4, "Moritz Roessler"), // done: out
    tk("P-10", 1, "", "High"), // same priority as P-4, later rank
  ];
  const p = pickTickets(COLS, tickets, ["Moritz Roessler"], { forMe: true });
  const keys = (id: string) => p.groups.find((g) => g.id === id)!.tickets.map((x) => x.key);
  assert.deepEqual(keys("mine"), ["P-7", "P-6"]);
  assert.deepEqual(keys("ready"), ["P-5", "P-4", "P-10", "P-2"]);
  assert.deepEqual(p.ready, ["Ready"]);
  assert.deepEqual(p.done, ["Done"]);
  assert.deepEqual(pickedIds(p), [7, 6, 5, 4, 10, 2]);
  // Without knowing you: only unassigned candidates, nothing "yours".
  const blind = pickTickets(COLS, tickets, [], { forMe: true });
  assert.deepEqual(blind.groups.map((g) => g.tickets.map((x) => x.key)), [[], ["P-4", "P-10", "P-2"]]);
  // A limit per group, the totals stay.
  const few = pickTickets(COLS, tickets, ["Moritz Roessler"], { forMe: true, limit: 1 });
  assert.deepEqual(few.groups.map((g) => [g.tickets.length, g.total]), [[1, 2], [1, 4]]);
});

test("criteria of the assistant's choosing: statuses, stages, assignee, priorities, types, text, sort", async () => {
  const { pickTickets } = await import("@/plugins/jira-lage/pick");
  n = 0;
  const tickets = [tk("Q-1", 1, "", "High", { type: "Bug", updated: "2026-11-01" }), tk("Q-2", 2, "Anna Other", "Low", { updated: "2026-11-09" }), tk("Q-3", 4, "", "High"), tk("Q-4", 0, "Moritz Roessler", "Highest", { type: "Bug" })];
  const keys = (c: Parameters<typeof pickTickets>[3]) => pickTickets(COLS, tickets, ["Moritz Roessler"], c).groups[0].tickets.map((x) => x.key);
  assert.deepEqual(keys({}), ["Q-4", "Q-1", "Q-2"], "default: everything not done, by priority");
  assert.deepEqual(keys({ statuses: ["done"] }), ["Q-3"], "a status named: that column, even done");
  assert.deepEqual(keys({ stages: ["ready", "active"], sort: "updated" }), ["Q-2", "Q-1"]);
  assert.deepEqual(keys({ assignee: "me" }), ["Q-4"]);
  assert.deepEqual(keys({ assignee: "others" }), ["Q-2"]);
  assert.deepEqual(keys({ assignee: "unassigned" }), ["Q-1"]);
  assert.deepEqual(keys({ types: ["bug"], sort: "board" }), ["Q-1", "Q-4"]);
  assert.deepEqual(keys({ priorities: ["high"] }), ["Q-1"]);
  assert.deepEqual(keys({ text: "title q-2" }), ["Q-2"]);
  // forMe narrowed by criteria.
  assert.deepEqual(pickTickets(COLS, tickets, ["Moritz Roessler"], { forMe: true, types: ["Bug"] }).groups.map((g) => g.tickets.map((x) => x.key)), [[], ["Q-1"]]);
});

test("criteria in an address: read back cleaned (unknown values dropped), odd input is no filter", async () => {
  const { encodePick, decodePick } = await import("@/plugins/jira-lage/pick");
  const c = { forMe: true, assignee: "me" as const, stages: ["ready" as const], title: "Next", reason: "Because" };
  assert.deepEqual(decodePick(encodePick(c)), c);
  assert.deepEqual(decodePick(JSON.stringify(c)), c, "as useSearchParams gives it (decoded)");
  assert.deepEqual(decodePick(JSON.stringify({ assignee: "everyone", stages: ["nope", "done"], sort: "x", limit: 1000 })), { stages: ["done"], limit: 100 });
  assert.equal(decodePick("{not json"), null);
  assert.equal(decodePick(null), null);
});

test("the tools: tickets for me read, a filtered board shown (embed for the assistant, link) — nothing on the board changes", async () => {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("workspace", true);
  setInstalled("jira-lage", true);
  process.env.JIRA_USERNAME = "moritz.roessler@example.com";
  const store = await import("@/plugins/workspace/store");
  const { setDatabaseSource, KEY_PROP } = await import("@/plugins/workspace/collections");
  const { getSqlite } = await import("@/db");
  const opts = ["Backlog", "Ready", "In Progress", "Done"].map((name, i) => ({ id: `o${i}`, name, color: "gray", group: (i === 3 ? "done" : i === 0 ? "todo" : "doing") as "todo" | "doing" | "done" }));
  const dbId = store.createPage({
    kind: "database",
    title: "Team Board",
    schema: {
      titleName: "Summary",
      properties: [
        { id: "jirastatus", name: "Status", type: "status", options: opts },
        { id: "jirapriority", name: "Priority", type: "select", options: [{ id: "ph", name: "High", color: "red" }, { id: "pl", name: "Low", color: "gray" }] },
        { id: "jiraassignee", name: "Assignee", type: "text" },
        { id: KEY_PROP, name: "Key", type: "text" },
      ],
      views: [{ id: "v1", name: "Board", type: "board", groupBy: "jirastatus", filter: [], sorts: [], hidden: [] }],
    } as never,
  });
  setDatabaseSource(dbId, "jira");
  getSqlite().exec("create table if not exists jira_board_dbs (board_id text primary key, db_id integer not null)");
  getSqlite().prepare("insert or replace into jira_board_dbs (board_id, db_id) values (?, ?)").run("jira-7", dbId);
  const add = (title: string, key: string, status: string, assignee?: string, prio?: string) => store.addRow(dbId, { title, cells: { jirastatus: status, jiraassignee: assignee, jirapriority: prio, [KEY_PROP]: key } });
  add("Old idea", "T-1", "o0");
  add("Small fix", "T-2", "o1", undefined, "pl");
  add("Big feature", "T-3", "o1", undefined, "ph");
  add("Taken", "T-4", "o1", "Anna Other");
  add("My work", "T-5", "o2", "Moritz Roessler");
  add("Shipped", "T-6", "o3", "Moritz Roessler");
  const before = JSON.stringify(store.rawRows(dbId));

  const { registerZeffTools } = await import("@/mcp/server");
  const t: Record<string, (a: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>> = {};
  registerZeffTools({ registerTool: (name: string, _c: unknown, fn: never) => void (t[name] = fn) } as never);
  const read = await t.workspace_tickets_for_me({});
  assert.equal(read.isError, undefined);
  const text = read.content[0].text;
  assert.match(text, /Still open for you \(1\):\n- \[row \d+\] T-5 “My work”/);
  assert.match(text, /Ready to pick up \(2\):\n- \[row \d+\] T-3 “Big feature”[^\n]*\n- \[row \d+\] T-2/);
  assert.doesNotMatch(text, /T-4|T-6|T-1/);
  assert.match(text, /moritz\.roessler@example\.com/);

  const shown = await t.workspace_board_filter({ board: "Team Board", stages: ["ready"], assignee: "unassigned", title: "Up for grabs", reason: "Nobody has them" });
  const { embedsOf } = await import("@/plugins/workspace/chat-embed");
  const embeds = embedsOf(shown);
  assert.equal(embeds.length, 1);
  assert.equal(embeds[0].dbId, dbId);
  assert.deepEqual(embeds[0].groups[0].tickets.map((x) => x.key), ["T-3", "T-2"]);
  assert.match(embeds[0].href, new RegExp(`^/workspace/${dbId}\\?pick=`));
  assert.equal(JSON.parse(JSON.stringify(shown)).content[0].text, shown.content[0].text, "over the MCP only the text goes out");
  assert.equal(Object.keys(JSON.parse(JSON.stringify(shown))).includes("embeds"), false);
  // Not a Jira board: refused.
  const plain = store.createPage({ kind: "database", title: "Plain list", schema: { titleName: "Name", properties: [], views: [] } as never });
  assert.equal((await t.workspace_board_filter({ board: plain })).isError, true);
  assert.equal(JSON.stringify(store.rawRows(dbId)), before, "read-only: the board is as it was");
});

test("the assistant's own pick: exactly the keys, in its order, with its why kept by cleanCriteria", async () => {
  const { pickTickets, cleanCriteria } = await import("@/plugins/jira-lage/pick");
  const ts = [tk("AB-1", 1), tk("AB-2", 1, "", "High"), tk("AB-3", 2, "Me"), tk("AB-4", 4)];
  const c = cleanCriteria({ keys: ["ab-2", "AB-3", "AB-9"], why: { "AB-2": "blocks the release", "XX-1": "not picked" }, forMe: true });
  assert.deepEqual(c?.keys, ["ab-2", "AB-3", "AB-9"]);
  assert.deepEqual(c?.why, { "AB-2": "blocks the release" });
  const r = pickTickets(COLS, ts, ["Me"], c!);
  assert.equal(r.groups.length, 1);
  assert.deepEqual(r.groups[0].tickets.map((x) => x.key), ["AB-2", "AB-3"]);
});
