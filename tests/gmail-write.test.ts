import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

type Seen = { method: string; path: string; body: unknown };

/** A Gmail of its own: labels (a few exist), batchModify, a search — what it was asked is kept. */
async function fakeGmail() {
  const seen: Seen[] = [];
  const labels = [
    { id: "INBOX", name: "INBOX", type: "system" },
    { id: "SPAM", name: "SPAM", type: "system" },
    { id: "UNREAD", name: "UNREAD", type: "system" },
    { id: "TRASH", name: "TRASH", type: "system" },
    { id: "Label_1", name: "notifications/Revolut", type: "user" },
  ];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const u = new URL(req.url ?? "/", "http://x");
      const body = raw ? JSON.parse(raw) : undefined;
      seen.push({ method: req.method ?? "", path: u.pathname + u.search, body });
      const json = (code: number, v: unknown) => (res.writeHead(code, { "content-type": "application/json" }), res.end(JSON.stringify(v)));
      if (u.pathname === "/token") return json(200, { access_token: "fresh", expires_in: 3600 });
      if (u.pathname === "/gmail/v1/users/me/labels" && req.method === "GET") return json(200, { labels });
      if (u.pathname === "/gmail/v1/users/me/labels" && req.method === "POST") {
        const l = { id: `Label_${labels.length + 1}`, name: body.name, type: "user" };
        labels.push(l);
        return json(200, l);
      }
      if (u.pathname === "/gmail/v1/users/me/messages/batchModify") return json(204, null);
      if (u.pathname === "/gmail/v1/users/me/messages")
        return json(200, { messages: [{ id: "18a2b3c4d5e6f701", threadId: "18a2b3c4d5e6f701" }] });
      if (u.pathname === "/gmail/v1/users/me/messages/18a2b3c4d5e6f701")
        return json(200, { id: "18a2b3c4d5e6f701", threadId: "t", labelIds: ["INBOX", "UNREAD"], snippet: "Dein Kredit", payload: { headers: [{ name: "From", value: "Verivox <info@verivox.de>" }, { name: "Subject", value: "Kredite" }] } });
      return json(404, { error: { message: "nope" } });
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.ZEFF_GOOGLE_API_URL = base;
  process.env.ZEFF_GOOGLE_TOKEN_URL = `${base}/token`;
  return { seen, close: () => server.close() };
}

async function signIn(scope: string) {
  const { updateConnector } = await import("@/lib/connectors/store");
  updateConnector("google", { authKind: "oauth", clientId: "app", clientSecret: "sec", refreshToken: "r1", accessToken: "good", expiresAt: Date.now() + 3600e3, scope });
}

const MODIFY = "openid email https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.modify";
const READONLY = "openid email https://www.googleapis.com/auth/gmail.readonly";
const ref = (hex: string) => `msg-f:${BigInt(`0x${hex}`).toString()}`;

test("changes are refused as long as Google was only asked for read access — and say what to do", async () => {
  const g = await fakeGmail();
  try {
    await signIn(READONLY);
    const { gmailCanWrite, changeGmail } = await import("@/lib/google/gmail-write");
    assert.equal(gmailCanWrite(), false);
    await assert.rejects(changeGmail({ refs: [ref("18a2b3c4d5e6f701")], addLabels: ["x"] }), /allow changes|Connections/i);
    assert.equal(g.seen.filter((s) => s.path.includes("batchModify")).length, 0);
  } finally {
    g.close();
  }
});

test("labels by name — an existing one is used, a new one made — read, spam; never the trash", async () => {
  const g = await fakeGmail();
  try {
    await signIn(MODIFY);
    const { gmailCanWrite, changeGmail } = await import("@/lib/google/gmail-write");
    assert.equal(gmailCanWrite(), true);
    const r = await changeGmail({ refs: [ref("18a2b3c4d5e6f701"), "18a2b3c4d5e6f703"], addLabels: ["notifications/Revolut", "Rechnungen"], markRead: true });
    assert.equal(r.changed, 2);
    assert.deepEqual(r.createdLabels, ["Rechnungen"]);
    const call = g.seen.find((s) => s.path.endsWith("/batchModify"))!;
    assert.deepEqual((call.body as { ids: string[] }).ids, ["18a2b3c4d5e6f701", "18a2b3c4d5e6f703"], "refs become Gmail's ids");
    assert.deepEqual((call.body as { addLabelIds: string[] }).addLabelIds.sort(), ["Label_1", "Label_6"].sort());
    assert.deepEqual((call.body as { removeLabelIds: string[] }).removeLabelIds, ["UNREAD"]);
    // Rechnungen exists now: a second change makes no label.
    const r2 = await changeGmail({ refs: [ref("18a2b3c4d5e6f701")], addLabels: ["rechnungen"] });
    assert.deepEqual(r2.createdLabels, []);
    // Spam: into spam, out of the inbox.
    await changeGmail({ refs: [ref("18a2b3c4d5e6f701")], spam: true });
    const spam = g.seen.filter((s) => s.path.endsWith("/batchModify")).at(-1)!.body as { addLabelIds: string[]; removeLabelIds: string[] };
    assert.deepEqual(spam.addLabelIds, ["SPAM"]);
    assert.ok(spam.removeLabelIds.includes("INBOX"));
    // No way to the trash, whatever the name.
    await assert.rejects(changeGmail({ refs: [ref("18a2b3c4d5e6f701")], addLabels: ["TRASH"] }), /trash|delete/i);
    await assert.rejects(changeGmail({ refs: [ref("18a2b3c4d5e6f701")], addLabels: ["trash"] }), /trash|delete/i);
  } finally {
    g.close();
  }
});

test("limits: nothing to change, no mails, not a Gmail id, too many at once", async () => {
  const g = await fakeGmail();
  try {
    await signIn(MODIFY);
    const { changeGmail, MAX_CHANGE } = await import("@/lib/google/gmail-write");
    await assert.rejects(changeGmail({ refs: [], addLabels: ["x"] }), /no mails/i);
    await assert.rejects(changeGmail({ refs: [ref("18a2b3c4d5e6f701")] }), /nothing to change/i);
    await assert.rejects(changeGmail({ refs: ["hello world"], markRead: true }), /Gmail message id/i);
    const many = Array.from({ length: MAX_CHANGE + 1 }, (_, i) => ref((0x18a2b3c4d5e60000 + i).toString(16)));
    await assert.rejects(changeGmail({ refs: many, markRead: true }), /at most/i);
  } finally {
    g.close();
  }
});

test("finding mails: Gmail's search, the mails as the agent needs them (id, sender, subject, labels)", async () => {
  const g = await fakeGmail();
  try {
    await signIn(READONLY);
    const { findGmail } = await import("@/lib/google/gmail-write");
    const found = await findGmail("from:verivox in:inbox", 20);
    assert.equal(found.length, 1);
    assert.equal(found[0].ref, ref("18a2b3c4d5e6f701"));
    assert.equal(found[0].from, "Verivox");
    assert.equal(found[0].subject, "Kredite");
    assert.equal(found[0].unread, true);
    assert.deepEqual(found[0].labels, ["INBOX", "UNREAD"]);
  } finally {
    g.close();
  }
});

test("a routine may change Gmail only when its permissions say so — and its worker's tools check it", async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "work", "todos"]) setInstalled(id, true);
  const w = await import("@/plugins/workspace/store");
  const r = await import("@/plugins/workspace/routines");
  const a = w.createPage({ title: "Ohne" });
  const b = w.createPage({ title: "Mit" });
  r.createRoutine(a, "agent");
  r.createRoutine(b, "agent", { permissions: { scope: "self", gmail: true } });
  assert.equal(r.getRoutine(a)!.permissions.gmail, undefined);
  assert.equal(r.getRoutine(b)!.permissions.gmail, true);
  r.updateRoutine(a, { permissions: { scope: "self", gmail: true } });
  assert.equal(r.getRoutine(a)!.permissions.gmail, true);
  r.updateRoutine(a, { permissions: { scope: "self", gmail: "yes" as never } });
  assert.equal(r.getRoutine(a)!.permissions.gmail, undefined, "only a real true counts");
  const { mayChangeGmail } = await import("@/plugins/workspace/routine-agent");
  assert.equal(mayChangeGmail(undefined), false, "not a routine's worker: no");
});

test("the worker of a routine that may change Gmail has that one tool approved in advance — no one else", async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "work", "todos"]) setInstalled(id, true);
  await import("@/plugins/workspace/server");
  const w = await import("@/plugins/workspace/store");
  const r = await import("@/plugins/workspace/routines");
  const { approvedToolsFor } = await import("@/lib/work/approved-tools");
  const { getSqlite } = await import("@/db");
  const page = w.createPage({ title: "Gmail-Agent" });
  r.createRoutine(page, "agent", { permissions: { scope: "self", gmail: true } });
  const plain = w.createPage({ title: "Ohne" });
  r.createRoutine(plain, "agent");
  const mk = (pageId: number, workRunId: number) => {
    const run = r.startRun(pageId, { kind: "manual" });
    r.setWorkRun(run, workRunId);
  };
  mk(page, 9001);
  mk(plain, 9002);
  void getSqlite;
  assert.deepEqual(approvedToolsFor(9001), ["mcp__zeff__gmail_change"]);
  assert.deepEqual(approvedToolsFor(9002), []);
  assert.deepEqual(approvedToolsFor(9003), [], "a run that belongs to no routine");
});

test("starting an agent whose routine may change Gmail hands its worker the approved tool — before the run is known to the routine", async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "work", "todos"]) setInstalled(id, true);
  const w = await import("@/plugins/workspace/store");
  const r = await import("@/plugins/workspace/routines");
  const { startAgent } = await import("@/plugins/workspace/routine-agent");
  const { grantTools, approvedToolsFor } = await import("@/lib/work/approved-tools");
  const asked: { approvedTools?: string[] }[] = [];
  const dispatch = (_todo: number, o: { approvedTools?: string[] }) => (asked.push(o), { id: 7001 });
  const withG = w.createPage({ title: "Darf" });
  r.createRoutine(withG, "agent", { permissions: { scope: "self", gmail: true } });
  const without = w.createPage({ title: "Darf nicht" });
  r.createRoutine(without, "agent");
  await startAgent(withG, { kind: "manual" }, {}, { dispatch });
  await startAgent(without, { kind: "manual" }, {}, { dispatch });
  assert.deepEqual(asked[0].approvedTools, ["mcp__zeff__gmail_change"]);
  assert.equal(asked[1].approvedTools, undefined);
  grantTools(7100, ["mcp__zeff__gmail_change", "mcp__zeff__gmail_change"]);
  assert.deepEqual(approvedToolsFor(7100), ["mcp__zeff__gmail_change"]);
});

test("a follow-up message to an agent (a new worker run on the same todo) is still that routine's worker", async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "work", "todos"]) setInstalled(id, true);
  const w = await import("@/plugins/workspace/store");
  const r = await import("@/plugins/workspace/routines");
  const { createRun } = await import("@/lib/work/store");
  const { mayChangeGmail } = await import("@/plugins/workspace/routine-agent");
  const page = w.createPage({ title: "Gmail-Agent 2" });
  r.createRoutine(page, "agent", { permissions: { scope: "self", gmail: true } });
  const base = { ticket: "", todoId: 880, mode: "code", provider: "claude", model: null, permissionMode: null, repo: null, prompt: "x" } as const;
  const first = createRun({ ...base });
  r.setWorkRun(r.startRun(page, { kind: "manual" }), first.id);
  const followUp = createRun({ ...base, afterRun: first.id });
  assert.equal(mayChangeGmail(first.id), true);
  assert.equal(mayChangeGmail(followUp.id), true, "same todo: the same routine");
  const other = createRun({ ...base, todoId: 881 });
  assert.equal(mayChangeGmail(other.id), false, "a run on another todo");
});
