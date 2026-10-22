import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/** The know plugin's MCP tools — meeting_brief and context_brief — behind the server's guard: what a caller may see of a brief. */

type Res = { isError?: boolean; content: { text: string }[] };
const pad = (n: number) => String(n).padStart(2, "0");
const local = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

async function setup() {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["people", "timeline", "know", "calendar", "workspace", "work"]) setInstalled(id, true);
  const { createPerson } = await import("@/plugins/people/store");
  const { addClaim } = await import("@/plugins/people/graph");
  const { recordEvent } = await import("@/plugins/timeline/store");
  const pid = createPerson({ name: "Lena Brandt", emails: ["lena@kunde.de"] });
  addClaim({ personId: pid, kind: "role", text: "Einkauf bei Kunde GmbH", status: "confirmed", sourceRef: "mail:x1" });
  recordEvent({ at: new Date(Date.now() - 864e5).toISOString(), kind: "mail", source: "mail", sourceRef: "x1", title: "Rahmenvertrag", refs: ["mail:x1", `person:${pid}`] });
  recordEvent({ at: new Date(Date.now() - 2 * 864e5).toISOString(), kind: "message", source: "whatsapp", sourceRef: "wa:7", title: "Lena Brandt", summary: "Privates Treffen am Samstag", refs: ["msg:whatsapp:wa:7", `person:${pid}`] });
  const { addEvent, zeffCalendar } = await import("@/lib/calendar/ir");
  const soon = new Date(Date.now() + 25 * 60e3);
  const ev = addEvent(zeffCalendar().id, { title: "Vertrag mit Lena", start: local(soon), end: local(new Date(soon.getTime() + 3600e3)), attendees: ["lena@kunde.de"] });

  const { guardTools } = await import("@/mcp/tool-guard");
  const { registerKnowTools } = await import("@/plugins/know/mcp");
  const { withCallerRun } = await import("@/mcp/caller");
  const handlers = new Map<string, (...a: unknown[]) => unknown>();
  const server = { registerTool: (name: string, _def: unknown, h: (...a: unknown[]) => unknown) => void handlers.set(name, h) };
  guardTools(server as never);
  const ok = (text: string) => ({ content: [{ type: "text" as const, text }] });
  const fail = (text: string) => ({ content: [{ type: "text" as const, text }], isError: true });
  const run = async (fn: () => unknown) => {
    try {
      return await fn();
    } catch (e) {
      return fail(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  registerKnowTools(server as never, { run, ok, fail } as never);
  const call = (name: string, args: unknown, workRun?: number) => withCallerRun(workRun ? String(workRun) : null, () => handlers.get(name)!(args, {})) as Promise<Res>;
  return { call, pid, ev };
}

let ctx: Awaited<ReturnType<typeof setup>> | null = null;
const get = async () => (ctx ??= await setup());

test("meeting_brief: the next meeting with people (or one by id) — who, what's open, the latest", async () => {
  const { call, ev } = await get();
  const next = await call("meeting_brief", {});
  assert.equal(next.isError, undefined, next.content[0].text);
  assert.match(next.content[0].text, /Vertrag mit Lena/);
  assert.match(next.content[0].text, /Lena Brandt \[person:\d+\]/);
  assert.match(next.content[0].text, /Einkauf bei Kunde GmbH/);
  const byId = await call("meeting_brief", { event: ev.id });
  assert.match(byId.content[0].text, /Vertrag mit Lena/);
  assert.equal((await call("meeting_brief", { event: 999999 })).isError, true);
});

test("context_brief: by a ref or a name; personal data only for a caller with that clearance", async () => {
  const { call, pid } = await get();
  const mine = await call("context_brief", { ref: "Lena Brandt" });
  assert.match(mine.content[0].text, /Privates Treffen/, "you (no Zeff run): personal data too");
  const worker = await call("context_brief", { ref: `person:${pid}` }, 8123);
  assert.equal(worker.isError, undefined);
  assert.ok(!worker.content[0].text.includes("Privates Treffen"), "a worker without the permission: not the WhatsApp message");
  assert.match(worker.content[0].text, /left out/);
  assert.equal((await call("context_brief", { ref: "Niemand Bekanntes" })).isError, true);
});
