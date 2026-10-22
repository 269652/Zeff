import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

type Tool = (a: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>;

const ago = (days: number) => new Date(Date.now() - days * 864e5).toISOString();

async function seed() {
  const { createPerson, listPeople } = await import("@/plugins/people/store");
  const had = listPeople().find((p) => p.name === "Julia Freidank");
  if (had) return had.id;
  const julia = createPerson({ name: "Julia Freidank", aliases: ["Jule"] });
  const { recordEvent } = await import("@/plugins/timeline/store");
  recordEvent({ at: ago(1), kind: "mail", source: "mail", sourceRef: "a1", title: "Angebot Relaunch", summary: "Hier das Angebot", refs: ["mail:a1", `person:${julia}`, "ticket:ORD-12"] });
  recordEvent({ at: ago(2), kind: "comment", source: "jira", sourceRef: "comment:1", title: "ORD-12 · Julia", summary: "Deployed", url: "https://jira/ORD-12", refs: ["ticket:ORD-12"] });
  recordEvent({ at: ago(40), kind: "message", source: "whatsapp", sourceRef: "w0", title: "Jule", summary: "Alt", refs: [`person:${julia}`] });
  return julia;
}

test("parseSince: spans back, a day, an ISO time", async () => {
  const { parseSince } = await import("@/plugins/timeline/query");
  const now = new Date("2026-10-22T12:00:00.000Z");
  assert.equal(parseSince("24h", now), "2026-10-21T12:00:00.000Z");
  assert.equal(parseSince("7d", now), "2026-10-15T12:00:00.000Z");
  assert.equal(parseSince("2026-10-01T08:00:00.000Z"), "2026-10-01T08:00:00.000Z");
  assert.equal(parseSince("2026-10-01"), new Date("2026-10-01T00:00").toISOString());
  assert.equal(parseSince("gestern irgendwann"), null);
});

test("the API: timeline.for by a name, timeline.since grouped — a built-in caller", async () => {
  const julia = await seed();
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("timeline", true);
  const { callBuiltin, apiMethods } = await import("@/lib/plugins/api");
  assert.equal(apiMethods()["timeline.for"].perm, "timeline.read");
  const r = await callBuiltin<{ ref: string; label: string; events: { title: string; entities: { ref: string }[] }[] }>("x", "timeline.for", { q: "Jule", since: "30d" });
  assert.equal(r.ref, `person:${julia}`);
  assert.equal(r.label, "Julia Freidank");
  assert.deepEqual(r.events.map((e) => e.title), ["Angebot Relaunch"]);
  assert.deepEqual(r.events[0].entities.map((e) => e.ref), ["ticket:ORD-12"], "the others it concerns, not itself nor its own mail");
  const s = await callBuiltin<{ groups: { ref: string; count: number }[] }>("x", "timeline.since", { since: "7d" });
  assert.equal(s.groups.find((g) => g.ref === "ticket:ORD-12")?.count, 2);
  await assert.rejects(callBuiltin("x", "timeline.for", { q: "niemand bekannt" }), /Nothing known/);
});

test("MCP: timeline_for and timeline_since answer in lines an agent reads", async () => {
  await seed();
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("timeline", true);
  const { registerZeffTools } = await import("@/mcp/server");
  const t: Record<string, Tool> = {};
  registerZeffTools({ registerTool: (name: string, _c: unknown, fn: never) => void (t[name] = fn) } as never);
  const text = async (name: string, args: Record<string, unknown>) => {
    const r = await t[name](args);
    return { text: r.content.map((c) => c.text).join("\n"), error: !!r.isError };
  };
  const forTicket = await text("timeline_for", { ref: "ORD-12" });
  assert.equal(forTicket.error, false);
  assert.match(forTicket.text, /ticket:ORD-12/);
  assert.match(forTicket.text, /comment \(jira\) \| ORD-12 · Julia — Deployed/);
  assert.match(forTicket.text, /https:\/\/jira\/ORD-12/);
  const since = await text("timeline_since", { since: "7d" });
  assert.match(since.text, /Julia Freidank \[person:\d+\] — 1/);
  assert.match(since.text, /ORD-12 \[ticket:ORD-12\] — 2/);
  assert.equal((await text("timeline_since", { since: "irgendwann" })).error, true);
  setInstalled("timeline", false);
  assert.equal((await text("timeline_for", { ref: "ORD-12" })).error, true, "off: not available");
});
