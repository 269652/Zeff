import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * Zeff writing to Gmail and Google Calendar — always against a Google of its own (a local server), never the real one:
 * the mail as it goes out (MIME, umlauts, recipients), replies in their thread, drafts, archive and unread, events inserted,
 * moved and answered, the guard that lets no delete through, and the scopes each opt-in asks for.
 */

type Seen = { method: string; path: string; body: any };

const ME = "me@example.com";
const THREAD = "18a2b3c4d5e6f700";

async function fakeGoogle() {
  const seen: Seen[] = [];
  const events = new Map<string, any>();
  events.set("inv1", {
    id: "inv1",
    summary: "Planung",
    start: { dateTime: "2026-10-27T10:00:00+01:00" },
    end: { dateTime: "2026-10-27T11:00:00+01:00" },
    organizer: { email: "boss@example.com" },
    attendees: [
      { email: "boss@example.com", organizer: true, responseStatus: "accepted" },
      { email: ME, self: true, responseStatus: "needsAction" },
      { email: "other@example.com", responseStatus: "needsAction" },
    ],
  });
  events.set("mine1", { id: "mine1", summary: "Fokus", start: { dateTime: "2026-10-27T08:00:00+01:00" }, end: { dateTime: "2026-10-27T09:00:00+01:00" }, organizer: { email: ME, self: true } });
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
      // Gmail
      if (p === `/gmail/v1/users/me/threads/${THREAD}` && req.method === "GET")
        return json(200, {
          id: THREAD,
          messages: [
            { id: "18a2b3c4d5e6f701", threadId: THREAD, labelIds: ["INBOX"], payload: { headers: [{ name: "Message-ID", value: "<first@mail.example.com>" }, { name: "Subject", value: "Angebot Küche" }, { name: "From", value: "Jörg <joerg@example.com>" }] } },
            { id: "18a2b3c4d5e6f702", threadId: THREAD, labelIds: ["INBOX", "UNREAD"], payload: { headers: [{ name: "Message-Id", value: "<second@mail.example.com>" }, { name: "References", value: "<first@mail.example.com>" }, { name: "Subject", value: "Re: Angebot Küche" }, { name: "From", value: "Jörg <joerg@example.com>" }] } },
          ],
        });
      if (p === "/gmail/v1/users/me/messages/send" && req.method === "POST") return json(200, { id: "sent1", threadId: body.threadId ?? "newthread", labelIds: ["SENT"] });
      if (p === "/gmail/v1/users/me/drafts" && req.method === "POST") return json(200, { id: "draft1", message: { id: "dm1", threadId: body.message.threadId ?? "newthread" } });
      if (p === "/gmail/v1/users/me/drafts/send" && req.method === "POST") return json(200, { id: "sent2", threadId: "newthread", labelIds: ["SENT"] });
      if (/^\/gmail\/v1\/users\/me\/threads\/[0-9a-f]+\/modify$/.test(p) && req.method === "POST") return json(200, { id: p.split("/")[6] });
      // Calendar
      const access: Record<string, { id: string; accessRole: string }> = {
        primary: { id: ME, accessRole: "owner" },
        [ME]: { id: ME, accessRole: "owner" },
        "team@group.calendar.google.com": { id: "team@group.calendar.google.com", accessRole: "writer" },
        "ro@group.calendar.google.com": { id: "ro@group.calendar.google.com", accessRole: "reader" },
      };
      if (p === "/calendar/v3/users/me/calendarList" && req.method === "GET")
        return json(200, { items: Object.values(access).filter((c, i, all) => all.findIndex((x) => x.id === c.id) === i).map((c) => ({ ...c, summary: c.id, selected: true })) });
      const cl = /^\/calendar\/v3\/users\/me\/calendarList\/(.+)$/.exec(p);
      if (cl && req.method === "GET") return access[decodeURIComponent(cl[1])] ? json(200, access[decodeURIComponent(cl[1])]) : json(404, { error: { message: "no" } });
      const list = /^\/calendar\/v3\/calendars\/([^/]+)\/events$/.exec(p);
      if (list && req.method === "POST") {
        const ev = { ...body, id: `new${events.size}`, htmlLink: "https://calendar.google.com/x" };
        events.set(ev.id, ev);
        return json(200, ev);
      }
      if (list && req.method === "GET") return json(200, { items: [...events.values()] });
      const one = /^\/calendar\/v3\/calendars\/([^/]+)\/events\/([^/]+)$/.exec(p);
      if (one && req.method === "GET") return events.has(one[2]) ? json(200, events.get(one[2])) : json(404, { error: { message: "no" } });
      if (one && req.method === "PATCH") {
        const ev = { ...(events.get(one[2]) ?? { id: one[2] }), ...body };
        events.set(one[2], ev);
        return json(200, ev);
      }
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
const GMAIL = `${READ} https://www.googleapis.com/auth/gmail.modify`;
const CAL = `${READ} https://www.googleapis.com/auth/calendar.events`;

async function signIn(scope: string) {
  const { updateConnector } = await import("@/lib/connectors/store");
  updateConnector("google", { authKind: "oauth", clientId: "app", clientSecret: "sec", refreshToken: "r1", accessToken: "good", expiresAt: Date.now() + 3600e3, scope });
}

/** The MIME message a send carried (Gmail's raw: base64url). */
const mimeOf = (s: Seen) => Buffer.from(String(s.body.raw ?? s.body.message?.raw), "base64url").toString("utf8");
const headerOf = (mime: string, name: string) => new RegExp(`^${name}: (.*(?:\\r\\n[ \\t].*)*)`, "mi").exec(mime.split("\r\n\r\n")[0])?.[1] ?? null;
/** An RFC 2047 header decoded (its encoded words joined). */
const decodeWords = (v: string) => v.replace(/\r\n[ \t]/g, "").replace(/=\?UTF-8\?B\?([^?]*)\?=\s*/gi, (_m, b) => Buffer.from(b, "base64").toString("utf8"));

test("a mail as it goes out: UTF-8 headers encoded, several recipients, the text base64 — no raw umlauts in the headers", async () => {
  const { buildMime } = await import("@/lib/google/gmail-send");
  const mime = buildMime({ to: "joerg@example.com; Jürgen Müller <juergen@example.com>", cc: "a@example.com, b@example.com", bcc: "c@example.com", subject: "Grüße zur Übergabe — Schlüssel & Zähler", body: "Hallo Jürgen,\nanbei die Zählerstände.\n\nViele Grüße\nMoritz" });
  const [head, payload] = mime.split("\r\n\r\n");
  assert.ok(/^[\x00-\x7f]*$/.test(head), "headers are 7-bit");
  assert.equal(decodeWords(headerOf(mime, "Subject")!), "Grüße zur Übergabe — Schlüssel & Zähler");
  const to = decodeWords(headerOf(mime, "To")!);
  assert.ok(to.includes("joerg@example.com") && to.includes("Jürgen Müller") && to.includes("<juergen@example.com>"), to);
  assert.equal(headerOf(mime, "Cc"), "a@example.com, b@example.com");
  assert.equal(headerOf(mime, "Bcc"), "c@example.com");
  assert.match(headerOf(mime, "Content-Type")!, /text\/plain; charset="?UTF-8"?/i);
  assert.equal(headerOf(mime, "Content-Transfer-Encoding"), "base64");
  assert.equal(headerOf(mime, "MIME-Version"), "1.0");
  assert.equal(Buffer.from(payload.replace(/\r\n/g, ""), "base64").toString("utf8"), "Hallo Jürgen,\r\nanbei die Zählerstände.\r\n\r\nViele Grüße\r\nMoritz");
  // A long subject is folded into several encoded words, none longer than 75 characters.
  const long = buildMime({ to: "x@example.com", subject: "Ä".repeat(80), body: "x" });
  for (const w of headerOf(long, "Subject")!.split(/\r\n[ \t]/)) assert.ok(w.trim().length <= 75, w);
  assert.equal(decodeWords(headerOf(long, "Subject")!), "Ä".repeat(80));
});

test("no header injection, no mail without a recipient", async () => {
  const { buildMime } = await import("@/lib/google/gmail-send");
  const mime = buildMime({ to: "x@example.com", subject: "Hi\r\nBcc: evil@example.com", body: "x" });
  assert.equal(headerOf(mime, "Bcc"), null);
  assert.throws(() => buildMime({ to: "", subject: "x", body: "x" }), /recipient/i);
  assert.throws(() => buildMime({ to: "not an address", subject: "x", body: "x" }), /address/i);
});

test("sending needs Gmail's write access — read-only says what to do, and nothing goes out", async () => {
  const g = await fakeGoogle();
  try {
    await signIn(READ);
    const { sendGmail } = await import("@/lib/google/gmail-send");
    await assert.rejects(sendGmail({ to: "x@example.com", subject: "s", body: "b" }), /Connections/);
    assert.equal(g.seen.filter((s) => s.method !== "GET").length, 0);
  } finally {
    g.close();
  }
});

test("a reply goes into its thread: threadId, In-Reply-To and References from the thread's last message, Re: subject", async () => {
  const g = await fakeGoogle();
  try {
    await signIn(GMAIL);
    const { sendGmail } = await import("@/lib/google/gmail-send");
    const r = await sendGmail({ to: "joerg@example.com", subject: "Danke", body: "Passt so.", thread: `gmail:${THREAD}` });
    assert.equal(r.id, "sent1");
    assert.equal(r.threadId, THREAD);
    const send = g.seen.find((s) => s.path === "/gmail/v1/users/me/messages/send")!;
    assert.equal(send.body.threadId, THREAD);
    const mime = mimeOf(send);
    assert.equal(headerOf(mime, "In-Reply-To"), "<second@mail.example.com>");
    assert.equal(headerOf(mime, "References"), "<first@mail.example.com> <second@mail.example.com>");
    assert.equal(decodeWords(headerOf(mime, "Subject")!), "Re: Angebot Küche");
    // A subject that already answers it stays.
    await sendGmail({ to: "joerg@example.com", subject: "AW: Angebot Küche", body: "x", thread: `gmail:${THREAD}` });
    assert.equal(decodeWords(headerOf(mimeOf(g.seen.filter((s) => s.path.endsWith("/messages/send")).at(-1)!), "Subject")!), "AW: Angebot Küche");
  } finally {
    g.close();
  }
});

test("drafts: made (in the thread), then sent by their id", async () => {
  const g = await fakeGoogle();
  try {
    await signIn(GMAIL);
    const { createGmailDraft, sendGmailDraft } = await import("@/lib/google/gmail-send");
    const d = await createGmailDraft({ to: "joerg@example.com", subject: "Frage", body: "Wann?", thread: `gmail:${THREAD}` });
    assert.equal(d.draftId, "draft1");
    const made = g.seen.find((s) => s.path === "/gmail/v1/users/me/drafts")!;
    assert.equal(made.body.message.threadId, THREAD);
    assert.equal(headerOf(mimeOf(made), "In-Reply-To"), "<second@mail.example.com>");
    const sent = await sendGmailDraft(d.draftId);
    assert.equal(sent.id, "sent2");
    assert.deepEqual(g.seen.find((s) => s.path === "/gmail/v1/users/me/drafts/send")!.body, { id: "draft1" });
  } finally {
    g.close();
  }
});

test("archive takes the thread out of the inbox; unread marks it unread — labels only", async () => {
  const g = await fakeGoogle();
  try {
    await signIn(GMAIL);
    const { archiveGmail, markGmailUnread } = await import("@/lib/google/gmail-send");
    await archiveGmail(`gmail:${THREAD}`);
    await markGmailUnread(`gmail:${THREAD}`);
    const mods = g.seen.filter((s) => s.path.endsWith("/modify"));
    assert.deepEqual(mods.map((m) => [m.path, m.body]), [
      [`/gmail/v1/users/me/threads/${THREAD}/modify`, { removeLabelIds: ["INBOX"] }],
      [`/gmail/v1/users/me/threads/${THREAD}/modify`, { addLabelIds: ["UNREAD"] }],
    ]);
    await assert.rejects(archiveGmail("outlook:abc"), /Gmail/);
  } finally {
    g.close();
  }
});

test("the guard: nothing is ever deleted, trashed or cancelled — whatever path or body", async () => {
  const { checkGoogleWrite } = await import("@/lib/google/write-guard");
  const ok = (m: string, p: string, b?: unknown) => assert.doesNotThrow(() => checkGoogleWrite(m, p, b), `${m} ${p}`);
  const no = (m: string, p: string, b?: unknown) => assert.throws(() => checkGoogleWrite(m, p, b), /never|not allowed/i, `${m} ${p}`);
  ok("POST", "/gmail/v1/users/me/messages/send", { raw: "x" });
  ok("POST", "/gmail/v1/users/me/drafts", { message: { raw: "x" } });
  ok("POST", "/gmail/v1/users/me/drafts/send", { id: "d" });
  ok("POST", `/gmail/v1/users/me/threads/${THREAD}/modify`, { removeLabelIds: ["INBOX"] });
  ok("POST", "/gmail/v1/users/me/messages/batchModify", { ids: ["a"], addLabelIds: ["SPAM"] });
  ok("POST", "/gmail/v1/users/me/labels", { name: "x" });
  ok("POST", "/gmail/v1/users/me/settings/filters", { criteria: {} });
  ok("POST", "/calendar/v3/calendars/primary/events?sendUpdates=none", { summary: "x" });
  ok("PATCH", "/calendar/v3/calendars/primary/events/abc?sendUpdates=all", { summary: "y" });
  no("DELETE", "/gmail/v1/users/me/messages/abc");
  no("DELETE", "/gmail/v1/users/me/drafts/abc");
  no("DELETE", "/calendar/v3/calendars/primary/events/abc");
  no("POST", "/gmail/v1/users/me/messages/abc/trash");
  no("POST", `/gmail/v1/users/me/threads/${THREAD}/trash`);
  no("POST", "/gmail/v1/users/me/messages/batchDelete", { ids: ["a"] });
  no("POST", `/gmail/v1/users/me/threads/${THREAD}/modify`, { addLabelIds: ["TRASH"] });
  no("POST", "/gmail/v1/users/me/messages/batchModify", { ids: ["a"], addLabelIds: ["trash"] });
  no("POST", "/gmail/v1/users/me/settings/filters", { criteria: {}, action: { addLabelIds: ["TRASH"] } });
  no("POST", "/gmail/v1/users/me/settings/forwardingAddresses", { forwardingEmail: "x@y" });
  no("PATCH", "/calendar/v3/calendars/primary/events/abc", { status: "cancelled" });
  no("POST", "/calendar/v3/calendars/primary/events", { summary: "x", status: "cancelled" });
  no("PUT", "/calendar/v3/calendars/primary/events/abc", { summary: "x" });
  no("POST", "/calendar/v3/calendars/primary/events/abc/move?destination=x");
  no("POST", "/calendar/v3/calendars/primary/clear");
  no("POST", "/calendar/v3/calendars/primary/events/quickAdd?text=x");
  no("GET", "/gmail/v1/users/me/messages/send");
});

test("no module talking to Google writes past the guard, and none of them deletes", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const dir = path.join(process.cwd(), "src/lib/google");
  for (const f of fs.readdirSync(dir)) {
    const text = fs.readFileSync(path.join(dir, f), "utf8");
    assert.ok(!/DELETE/.test(text) || f === "write-guard.ts", `${f} names DELETE`);
    if (f === "write-guard.ts") continue;
    assert.ok(!/method:\s*["'`]/.test(text), `${f} makes a write request of its own — through googleWrite (write-guard.ts) only`);
  }
});

test("scopes: each opt-in asks for its own right, nothing more", async () => {
  const { updateConnector, extraOf } = await import("@/lib/connectors/store");
  const { PROVIDERS } = await import("@/lib/connectors/providers");
  const scope = () => PROVIDERS.google.endpoints().scope.split(" ");
  updateConnector("google", { extra: JSON.stringify({ ...extraOf("google"), gmailWrite: "0", calendarWrite: "0" }) });
  assert.ok(!scope().includes("https://www.googleapis.com/auth/gmail.modify"));
  assert.ok(!scope().includes("https://www.googleapis.com/auth/calendar.events"));
  assert.ok(scope().includes("https://www.googleapis.com/auth/calendar.readonly"));
  updateConnector("google", { extra: JSON.stringify({ ...extraOf("google"), gmailWrite: "1" }) });
  assert.ok(scope().includes("https://www.googleapis.com/auth/gmail.modify"));
  assert.ok(!scope().includes("https://www.googleapis.com/auth/calendar.events"));
  updateConnector("google", { extra: JSON.stringify({ ...extraOf("google"), gmailWrite: "0", calendarWrite: "1" }) });
  assert.ok(!scope().includes("https://www.googleapis.com/auth/gmail.modify"));
  assert.ok(scope().includes("https://www.googleapis.com/auth/calendar.events"));
  updateConnector("google", { extra: JSON.stringify({ ...extraOf("google"), calendarWrite: "0" }) });
});

test("calendar writes need the calendar.events right; the granted scope says so", async () => {
  const g = await fakeGoogle();
  try {
    await signIn(READ);
    const { gcalCanWrite, insertGcalEvent } = await import("@/lib/google/calendar-write");
    assert.equal(gcalCanWrite(), false);
    await assert.rejects(insertGcalEvent("primary", { title: "x", start: "2026-10-27T10:00", end: "2026-10-27T11:00" }), /Connections/);
    await signIn(CAL);
    assert.equal(gcalCanWrite(), true);
    assert.equal(g.seen.filter((s) => s.method !== "GET").length, 0);
  } finally {
    g.close();
  }
});

test("an event inserted: times in the local zone, all-day as dates, guests invited — only in a calendar you own or may write", async () => {
  const g = await fakeGoogle();
  try {
    await signIn(CAL);
    const { insertGcalEvent } = await import("@/lib/google/calendar-write");
    const r = await insertGcalEvent("primary", { title: "Zahnarzt", start: "2026-10-27T10:00", end: "2026-10-27T10:45", location: "Praxis", description: "Kontrolle" });
    assert.equal(r.calendarId, ME, "primary is resolved to its id");
    const post = g.seen.find((s) => s.method === "POST" && s.path.startsWith(`/calendar/v3/calendars/primary/events`))!;
    assert.match(post.path, /sendUpdates=none/);
    assert.equal(post.body.summary, "Zahnarzt");
    assert.equal(post.body.location, "Praxis");
    assert.equal(post.body.description, "Kontrolle");
    assert.equal(post.body.start.dateTime, "2026-10-27T10:00:00");
    assert.equal(post.body.end.dateTime, "2026-10-27T10:45:00");
    assert.equal(post.body.start.timeZone, Intl.DateTimeFormat().resolvedOptions().timeZone);
    await insertGcalEvent("team@group.calendar.google.com", { title: "Offsite", start: "2026-11-02", end: "2026-11-04", allDay: true, attendees: ["a@example.com", "b@example.com"] });
    const team = g.seen.filter((s) => s.method === "POST").at(-1)!;
    assert.match(team.path, /sendUpdates=all/);
    assert.deepEqual(team.body.start, { date: "2026-11-02" });
    assert.deepEqual(team.body.end, { date: "2026-11-04" });
    assert.deepEqual(team.body.attendees, [{ email: "a@example.com" }, { email: "b@example.com" }]);
    const before = g.seen.filter((s) => s.method === "POST").length;
    await assert.rejects(insertGcalEvent("ro@group.calendar.google.com", { title: "x", start: "2026-10-27T10:00", end: "2026-10-27T11:00" }), /can't write|read-only/i);
    assert.equal(g.seen.filter((s) => s.method === "POST").length, before);
  } finally {
    g.close();
  }
});

test("an event moved or edited is patched; an invitation answered for you alone — nothing cancelled", async () => {
  const g = await fakeGoogle();
  try {
    await signIn(CAL);
    const { patchGcalEvent, respondGcalEvent } = await import("@/lib/google/calendar-write");
    await patchGcalEvent(ME, "mine1", { start: "2026-10-27T14:00", end: "2026-10-27T15:00" });
    const patch = g.seen.find((s) => s.method === "PATCH")!;
    assert.equal(patch.path.split("?")[0], `/calendar/v3/calendars/${encodeURIComponent(ME)}/events/mine1`);
    assert.match(patch.path, /sendUpdates=none/, "no guests: nobody mailed");
    // Someone else's meeting isn't moved from here.
    await assert.rejects(patchGcalEvent(ME, "inv1", { start: "2026-10-27T14:00", end: "2026-10-27T15:00" }), /organiser/);
    assert.equal(patch.body.start.dateTime, "2026-10-27T14:00:00");
    assert.equal(patch.body.summary, undefined, "only what changed");
    await respondGcalEvent(ME, "inv1", "tentative");
    const answer = g.seen.filter((s) => s.method === "PATCH").at(-1)!;
    assert.match(answer.path, /sendUpdates=all/);
    assert.deepEqual(
      answer.body.attendees.map((a: { email: string; responseStatus: string }) => [a.email, a.responseStatus]),
      [["boss@example.com", "accepted"], [ME, "tentative"], ["other@example.com", "needsAction"]],
    );
    assert.equal(Object.keys(answer.body).join(","), "attendees");
    await assert.rejects(respondGcalEvent(ME, "inv1", "cancelled" as never), /accepted|declined|tentative/);
  } finally {
    g.close();
  }
});

test("after a write the synced copy of those days is read again — the calendar shows it at once", async () => {
  const g = await fakeGoogle();
  try {
    await signIn(CAL);
    const { insertGcalEvent } = await import("@/lib/google/calendar-write");
    const { eventsBetween } = await import("@/lib/calendar/ir");
    await insertGcalEvent("primary", { title: "Friseur", start: "2026-10-28T09:00", end: "2026-10-28T09:30" });
    const shown = eventsBetween("2026-10-28", "2026-10-29").map((e) => e.title);
    assert.ok(shown.includes("Friseur"), shown.join(", "));
    const reads = g.seen.filter((s) => s.method === "GET" && /\/calendar\/v3\/calendars\/[^/]+\/events\?/.test(s.path));
    assert.ok(reads.length >= 1 && reads.every((s) => s.path.startsWith(`/calendar/v3/calendars/${encodeURIComponent(ME)}/events`)), "only the calendar written to is read");
  } finally {
    g.close();
  }
});
