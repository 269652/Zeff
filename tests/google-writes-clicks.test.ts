import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * Gmail and Google Calendar written on your click — a todo's mail sent or saved as a draft (in the thread of the mail the todo
 * came from), a todo's appointment entered in Google Calendar, a reply from an inbox row, a conversation archived or marked
 * unread — and as before (Gmail's / Google's window opened, filled in) as long as Google wasn't asked for the right. Against a
 * fake Google only.
 */

type Seen = { method: string; path: string; body: any };
const ME = "me@example.com";
const THREAD = "18a2b3c4d5e6f700";

async function fakeGoogle() {
  const seen: Seen[] = [];
  const events: any[] = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const u = new URL(req.url ?? "/", "http://x");
      const body = raw ? JSON.parse(raw) : undefined;
      seen.push({ method: req.method ?? "", path: u.pathname + u.search, body });
      const json = (code: number, v: unknown) => (res.writeHead(code, { "content-type": "application/json" }), res.end(JSON.stringify(v)));
      const p = u.pathname;
      if (p === "/token") return json(200, { access_token: "fresh", expires_in: 3600 });
      if (p === `/gmail/v1/users/me/threads/${THREAD}`)
        return json(200, { id: THREAD, messages: [{ id: "18a2b3c4d5e6f701", threadId: THREAD, payload: { headers: [{ name: "Message-ID", value: "<a@x>" }, { name: "Subject", value: "Angebot Küche" }] } }] });
      if (p === "/gmail/v1/users/me/messages/send") return json(200, { id: "sent1", threadId: body.threadId ?? "new" });
      if (p === "/gmail/v1/users/me/drafts") return json(200, { id: "draft1", message: { id: "dm1", threadId: body.message.threadId ?? "new" } });
      if (/^\/gmail\/v1\/users\/me\/threads\/[0-9a-f]+\/modify$/.test(p)) return json(200, {});
      if (p === "/calendar/v3/users/me/calendarList/primary" || p === `/calendar/v3/users/me/calendarList/${encodeURIComponent(ME)}`) return json(200, { id: ME, accessRole: "owner" });
      if (p === "/calendar/v3/users/me/calendarList") return json(200, { items: [{ id: ME, summary: "Moritz", accessRole: "owner", selected: true }] });
      const list = /^\/calendar\/v3\/calendars\/(primary|me%40example\.com)\/events$/.exec(p);
      if (list && req.method === "POST") {
        const ev = { ...body, id: `ev${events.length}`, organizer: { email: ME, self: true } };
        events.push(ev);
        return json(200, ev);
      }
      if (list && req.method === "GET") return json(200, { items: events });
      const one = /^\/calendar\/v3\/calendars\/me%40example\.com\/events\/([\w-]+)$/.exec(p);
      const at = one ? events.findIndex((e) => e.id === one[1]) : -1;
      if (one && at >= 0 && req.method === "GET") return json(200, events[at]);
      if (one && at >= 0 && req.method === "PATCH") return json(200, (events[at] = { ...events[at], ...body }));
      return json(404, { error: { message: `nope ${req.method} ${p}` } });
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.ZEFF_GOOGLE_API_URL = base;
  process.env.ZEFF_GOOGLE_TOKEN_URL = `${base}/token`;
  return { seen, events, close: () => server.close() };
}

const READ = "openid email https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar.readonly";
const ALL = `${READ} https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/calendar.events`;
async function signIn(scope: string) {
  const { updateConnector } = await import("@/lib/connectors/store");
  updateConnector("google", { authKind: "oauth", clientId: "app", clientSecret: "sec", refreshToken: "r1", accessToken: "good", expiresAt: Date.now() + 3600e3, scope });
}
const writes = (g: { seen: Seen[] }) => g.seen.filter((s) => s.method !== "GET" && s.path !== "/token");

async function setup() {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["gmail", "google-calendar", "calendar", "todos", "workspace", "auto-actions"]) setInstalled(id, true);
}

/** A todo the Mail-Durchsicht found in Jörg's Gmail mail, with a mail to send as its action. */
let mails = 0;
async function mailTodo(op: Record<string, unknown>, text = "Jörg auf das Angebot antworten") {
  const { saveMails, keyOf } = await import("@/lib/mail/store");
  const mail = { id: `msg-f:${++mails}0`, convId: `gmail:${THREAD}`, folder: "Gmail", from: "Jörg", fromEmail: "joerg@example.com", subject: "Angebot Küche", preview: "Passt Dienstag?", receivedAt: new Date().toISOString(), unread: true };
  saveMails([mail]);
  const store = await import("@/lib/todos/store");
  const todo = store.addMailTodo({ ticket: "", text, kind: "reply", refs: [`mail:${keyOf(mail)}`], runId: null });
  store.setTodoOps(todo.id, [op as never], undefined);
  return store.getTodo(todo.id)!;
}

test("what the pages are told: Gmail sends / Google Calendar writes only when Google holds the right", async () => {
  await setup();
  const { googleGrants } = await import("@/lib/google/grants");
  await signIn(READ);
  assert.deepEqual(googleGrants(), []);
  await signIn(`${READ} https://www.googleapis.com/auth/gmail.modify`);
  assert.deepEqual(googleGrants(), ["gmail-send"]);
  await signIn(ALL);
  assert.deepEqual(googleGrants(), ["gmail-send", "gcal-write"]);
});

test("a todo's mail: without the right the Gmail window as before (nothing sent); with it sent through the API, in the thread of the todo's mail", async () => {
  await setup();
  const g = await fakeGoogle();
  try {
    const op = { type: "gmail-compose", to: "joerg@example.com", subject: "Re: Angebot Küche", body: "Dienstag passt." };
    const todo = await mailTodo(op);
    const { actionHref } = await import("@/plugins/actions/catalog");
    assert.match(actionHref(todo.ops[0])!, /^https:\/\/mail\.google\.com/, "the browser window stays the way without the right");
    const { runGmailComposeOnTodo } = await import("@/plugins/gmail/run");
    await signIn(READ);
    await assert.rejects(runGmailComposeOnTodo(todo.id, 0, "send"), /Connections/);
    assert.equal(writes(g).length, 0);
    const store = await import("@/lib/todos/store");
    assert.equal(store.getTodo(todo.id)!.ops.length, 1, "still on the todo");

    await signIn(ALL);
    const r = await runGmailComposeOnTodo(todo.id, 0, "send");
    assert.match(r.what, /sent/i);
    const send = writes(g).find((s) => s.path === "/gmail/v1/users/me/messages/send")!;
    assert.equal(send.body.threadId, THREAD, "a reply in the mail's thread");
    const after = store.getTodo(todo.id)!;
    assert.equal(after.ops.length, 0, "off the todo");
    assert.equal(after.status, "done", "a reply that was the todo: done");
    assert.ok(after.userNotes.some((n) => /sent/i.test(n.text)), "noted on the todo");
  } finally {
    g.close();
  }
});

test("a todo's mail saved as a draft in Gmail instead — and a mail to someone else is a new conversation", async () => {
  await setup();
  const g = await fakeGoogle();
  try {
    await signIn(ALL);
    const todo = await mailTodo({ type: "gmail-compose", to: "vermieter@example.com", subject: "Küche", body: "Hallo,\nkurze Frage." }, "Den Vermieter nach dem Wasseranschluss fragen");
    const { runGmailComposeOnTodo } = await import("@/plugins/gmail/run");
    const r = await runGmailComposeOnTodo(todo.id, 0, "draft");
    assert.match(r.what, /draft/i);
    const d = writes(g).find((s) => s.path === "/gmail/v1/users/me/drafts")!;
    assert.equal(d.body.message.threadId, undefined, "not Jörg's thread");
    assert.equal(writes(g).filter((s) => s.path.endsWith("/messages/send")).length, 0, "a draft is not sent");
    await assert.rejects(runGmailComposeOnTodo(todo.id, 0, "send"), /isn't on the todo|any more/i, "done once: not twice");
  } finally {
    g.close();
  }
});

test("a todo's appointment entered in Google Calendar (primary) on the click — shown in Zeff's calendar at once", async () => {
  await setup();
  const g = await fakeGoogle();
  try {
    await signIn(ALL);
    const store = await import("@/lib/todos/store");
    const todo = store.addManualTodo({ ticket: "", text: `Geschenk ${Math.random()}` });
    store.setTodoOps(todo.id, [{ type: "gcal-event", title: "Geschenk besorgen", start: "2026-11-03T18:00", minutes: 60, body: "für Nadine" } as never]);
    const { runGcalEventOnTodo } = await import("@/plugins/google-calendar/run");
    const r = await runGcalEventOnTodo(todo.id, 0);
    assert.match(r.what, /Google Calendar/);
    const post = writes(g).find((s) => s.path.startsWith("/calendar/v3/calendars/primary/events"))!;
    assert.equal(post.body.summary, "Geschenk besorgen");
    assert.equal(post.body.end.dateTime, "2026-11-03T19:00:00");
    assert.equal(store.getTodo(todo.id)!.ops.length, 0);
    const { eventsBetween } = await import("@/lib/calendar/ir");
    assert.ok(eventsBetween("2026-11-03", "2026-11-04").some((e) => e.title === "Geschenk besorgen"));
  } finally {
    g.close();
  }
});

test("an inbox row of a Gmail mail: Reply sends through the API in its thread (or a draft) on your click; archive and unread", async () => {
  await setup();
  const g = await fakeGoogle();
  try {
    const { saveMails } = await import("@/lib/mail/store");
    saveMails([{ id: "msg-f:2", convId: `gmail:${THREAD}`, folder: "Gmail", from: "Jörg", fromEmail: "joerg@example.com", subject: "Angebot Küche", preview: "Und?", receivedAt: new Date().toISOString(), unread: true }]);
    const w = await import("@/plugins/workspace/store");
    const { runPipeline } = await import("@/plugins/workspace/pipeline");
    const { createSourceDatabase } = await import("@/plugins/workspace/derived");
    const { capabilitiesOf } = await import("@/plugins/workspace/capabilities");
    const db = createSourceDatabase("mail");
    await runPipeline(db, { ai: false });
    const row = w.rawRows(db).find((r) => String(r.cells.mailconv ?? r.cells.commconv ?? "").startsWith("gmail:"))!;
    assert.ok(row, "the Gmail mail is a row");
    const { runRowOp } = await import("@/lib/ops");
    const { gmailRowChange } = await import("@/plugins/gmail/run");
    const reply = { type: "gmail-compose", to: "joerg@example.com", subject: "AW: Angebot Küche", body: "Ja." };

    await signIn(READ);
    assert.ok(capabilitiesOf(w.getDatabase(db)!.schema).drafts.includes("Gmail"), "read-only: a draft you send in Gmail");
    assert.match((await runRowOp(row.id, reply)).href ?? "", /mail\.google\.com/);
    await assert.rejects(runRowOp(row.id, reply, "send"), /Connections/);
    await assert.rejects(gmailRowChange(row.id, "archive"), /Connections/);
    assert.equal(writes(g).length, 0);

    await signIn(ALL);
    const caps = capabilitiesOf(w.getDatabase(db)!.schema);
    assert.ok(caps.sends.includes("Gmail") && !caps.drafts.includes("Gmail"), "with the right: Zeff sends it");
    assert.match((await runRowOp(row.id, reply)).href ?? "", /mail\.google\.com/, "without a choice still the window");
    const sent = await runRowOp(row.id, reply, "send");
    assert.match(sent.what ?? "", /sent/i);
    assert.equal(writes(g).find((s) => s.path.endsWith("/messages/send"))!.body.threadId, THREAD);
    await runRowOp(row.id, reply, "draft");
    assert.equal(writes(g).find((s) => s.path.endsWith("/drafts"))!.body.message.threadId, THREAD);
    await gmailRowChange(row.id, "archive");
    await gmailRowChange(row.id, "unread");
    assert.deepEqual(writes(g).filter((s) => s.path.endsWith("/modify")).map((s) => s.body), [{ removeLabelIds: ["INBOX"] }, { addLabelIds: ["UNREAD"] }]);
  } finally {
    g.close();
  }
});

test("an AI proposal can't smuggle in a send: what it hands over is cleaned to the fields of a draft", async () => {
  const { cleanActions } = await import("@/plugins/actions/catalog");
  const [op] = cleanActions([{ type: "gmail-compose", to: "a@example.com", subject: "s", body: "b", mode: "send", via: "api", send: true }], { ticket: "" });
  assert.deepEqual(Object.keys(op).sort(), ["body", "subject", "to", "type"]);
});

test("the calendar app: a new event in a Google calendar you may write goes there, a drag patches it, an invitation is answered — no delete", async () => {
  await setup();
  const g = await fakeGoogle();
  try {
    await signIn(ALL);
    const ir = await import("@/lib/calendar/ir");
    const { saveEventAction, respondEventAction, deleteEventAction, acceptProposedEventAction } = await import("@/plugins/calendar/server-actions");
    const cal = ir.ensureCalendar(`google:${ME}`, { source: "google", name: "Moritz" });
    const made = await saveEventAction({ calendarId: cal.id, title: "Laufen", start: "2026-11-05T07:00", end: "2026-11-05T08:00", attendees: ["anna@example.com"] });
    assert.equal(made!.ok, true, made!.error);
    const post = writes(g).find((s) => s.method === "POST" && s.path.startsWith(`/calendar/v3/calendars/${encodeURIComponent(ME)}/events`))!;
    assert.equal(post.body.summary, "Laufen");
    assert.deepEqual(post.body.attendees, [{ email: "anna@example.com" }]);
    const ev = ir.eventsBetween("2026-11-05", "2026-11-06").find((e) => e.title === "Laufen")!;
    assert.ok(ev, "read back at once");
    assert.equal(ev.response, "organizer", "your own meeting with a guest: nothing to answer");

    const moved = await saveEventAction({ id: ev.id, calendarId: cal.id, title: "Laufen", start: "2026-11-05T18:00", end: "2026-11-05T19:00" });
    assert.equal(moved!.ok, true, moved!.error);
    const patch = writes(g).find((s) => s.method === "PATCH")!;
    assert.equal(patch.path.split("?")[0], `/calendar/v3/calendars/${encodeURIComponent(ME)}/events/${post.body.id ?? "ev0"}`);
    assert.equal(patch.body.start.dateTime, "2026-11-05T18:00:00");
    assert.match(patch.path, /sendUpdates=all/, "Anna is told");
    assert.equal(ir.eventsBetween("2026-11-05", "2026-11-06").find((e) => e.title === "Laufen")!.start, "2026-11-05T18:00");

    // An invitation from someone else: answered (for you) — not moved.
    g.events.push({ id: "inv9", summary: "Review", start: { dateTime: "2026-11-05T10:00:00" }, end: { dateTime: "2026-11-05T11:00:00" }, organizer: { email: "boss@example.com" }, attendees: [{ email: "boss@example.com", responseStatus: "accepted" }, { email: ME, self: true, responseStatus: "needsAction" }] });
    const { refreshGcalDays } = await import("@/lib/google/calendar-write");
    await refreshGcalDays(ME, ["2026-11-05"]);
    const inv = ir.eventsBetween("2026-11-05", "2026-11-06").find((e) => e.title === "Review")!;
    assert.equal(inv.response, "notResponded");
    const yes = await respondEventAction(inv.id, "accepted");
    assert.equal(yes!.ok, true, yes!.error);
    assert.equal(writes(g).filter((s) => s.method === "PATCH").at(-1)!.body.attendees[1].responseStatus, "accepted");
    assert.equal(ir.eventsBetween("2026-11-05", "2026-11-06").find((e) => e.title === "Review")!.response, "accepted");
    const now = ir.eventsBetween("2026-11-05", "2026-11-06").find((e) => e.title === "Review")!;
    const drag = await saveEventAction({ id: now.id, calendarId: cal.id, title: "Review", start: "2026-11-05T12:00", end: "2026-11-05T13:00" });
    assert.equal(drag!.ok, false, "someone else's meeting isn't moved");

    const before = writes(g).length;
    const del = await deleteEventAction(ir.eventsBetween("2026-11-05", "2026-11-06").find((e) => e.title === "Laufen")!.id);
    assert.equal(del!.ok, false, "a Google event is never deleted from Zeff");
    assert.match(del!.error ?? "", /never deletes/);
    assert.equal(writes(g).length, before);
    assert.equal(g.seen.filter((s) => s.method === "DELETE").length, 0);

    // A todo's proposed Google appointment, accepted in the calendar: entered through the API.
    const store = await import("@/lib/todos/store");
    const todo = store.addManualTodo({ ticket: "", text: "Reifenwechsel ausmachen" });
    store.setTodoOps(todo.id, [{ type: "gcal-event", title: "Reifenwechsel", start: "2026-11-06T09:00", minutes: 30, body: "" } as never]);
    const ok = await acceptProposedEventAction(todo.id, 0, "Reifenwechsel");
    assert.equal(ok!.ok, true, ok!.error);
    assert.ok(writes(g).some((s) => s.method === "POST" && s.body?.summary === "Reifenwechsel"));
    assert.equal(store.getTodo(todo.id)!.ops.length, 0);

    // What the calendar app is told: your Google calendar writable — learnt from Google once when no sync said so.
    const { setPref } = await import("@/lib/prefs");
    setPref("google-calendar:writable", null);
    const { calendarViewData } = await import("@/plugins/calendar/view-data");
    assert.equal((await calendarViewData("week", "2026-11-05")).calendars.find((c) => c.key === `google:${ME}`)!.writable, true);
    await signIn(READ);
    assert.equal((await calendarViewData("week", "2026-11-05")).calendars.find((c) => c.key === `google:${ME}`)!.writable, undefined, "without the right: read-only");
  } finally {
    g.close();
  }
});

test("in the calendar views: your events of a writable Google calendar can be changed, invitations only answered, the rest read-only", async () => {
  const { calendarItems } = await import("@/plugins/calendar/view-shared");
  const base = { key: "", visible: true, busy: true, book: false, todos: false, color: "#000" };
  const cals = [
    { ...base, id: 1, key: "google:me@example.com", source: "google" as const, name: "Moritz", writable: true },
    { ...base, id: 2, key: "google:ro@group.calendar.google.com", source: "google" as const, name: "Feiertage" },
  ];
  const ev = (id: number, calendarId: number, response: string | null) => ({ id, calendarId, key: `k${id}`, title: `e${id}`, start: "2026-11-05T10:00", end: "2026-11-05T11:00", allDay: false, location: "", description: "", showAs: "busy", cancelled: false, response, private: false, online: false, organizer: "", attendees: [], url: "", todoId: null, recurrence: null, occurrence: null, seriesId: null, proposed: false });
  const items = calendarItems([ev(1, 1, null), ev(2, 1, "organizer"), ev(3, 1, "notResponded"), ev(4, 2, null)], [], cals, () => true, false);
  assert.deepEqual(items.map((i) => [i.title, i.editable]), [["e1", true], ["e2", true], ["e3", false], ["e4", false]]);
});
