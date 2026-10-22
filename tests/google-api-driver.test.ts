import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

type Seen = { method: string; url: string; auth: string; body: string };

const b64 = (s: string) => Buffer.from(s).toString("base64url");
const hex = "18a2b3c4d5e6f701";
const sentHex = "18a2b3c4d5e6f702";
const decimal = (h: string) => BigInt(`0x${h}`).toString();

const header = (name: string, value: string) => ({ name, value });
const when = (iso: string) => String(Date.parse(iso));

/** A Google of its own (Gmail + Calendar APIs and the OAuth token endpoint): what it was asked, what it answers. */
async function fakeGoogle() {
  const seen: Seen[] = [];
  const recent = new Date(Date.now() - 3600e3).toISOString();
  const earlier = new Date(Date.now() - 7200e3).toISOString();
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const u = new URL(req.url ?? "/", "http://x");
      seen.push({ method: req.method ?? "", url: `${u.pathname}${u.search}`, auth: String(req.headers.authorization ?? ""), body });
      const json = (code: number, v: unknown) => (res.writeHead(code, { "content-type": "application/json" }), res.end(JSON.stringify(v)));
      const p = u.pathname;
      if (p === "/token") return json(200, { access_token: "fresh", expires_in: 3600 });
      if (req.headers.authorization === "Bearer stale" || req.headers.authorization === "Bearer revoked") return json(401, { error: { message: "Invalid Credentials" } });
      const q = u.searchParams.get("q") ?? "";
      if (p === "/gmail/v1/users/me/messages") {
        if (q.startsWith("in:inbox") && q.includes("has:attachment")) return json(200, { messages: [{ id: hex, threadId: hex }] });
        if (q.startsWith("in:inbox")) return json(200, { messages: [{ id: hex, threadId: hex }] });
        if (q.startsWith("in:sent")) return json(200, q.includes("has:attachment") ? {} : { messages: [{ id: sentHex, threadId: hex }] });
        return json(200, {});
      }
      if (p === `/gmail/v1/users/me/messages/${hex}` && u.searchParams.get("format") === "metadata")
        return json(200, { id: hex, threadId: hex, labelIds: ["INBOX", "UNREAD"], snippet: "Hello &amp; welcome", internalDate: when(earlier), payload: { headers: [header("From", '"Anna Beispiel" <Anna@Example.com>'), header("Subject", "Invoice")] } });
      if (p === `/gmail/v1/users/me/messages/${sentHex}` && u.searchParams.get("format") === "metadata")
        return json(200, { id: sentHex, threadId: hex, labelIds: ["SENT"], snippet: "Thanks", internalDate: when(recent), payload: { headers: [header("From", "me@example.com"), header("Subject", "Re: Invoice")] } });
      if (p === `/gmail/v1/users/me/threads/${hex}`)
        return json(200, {
          messages: [
            { id: hex, threadId: hex, labelIds: ["INBOX", "UNREAD"], snippet: "Hello", internalDate: when(earlier), payload: { headers: [header("From", "Anna <anna@example.com>"), header("Subject", "Invoice")], mimeType: "text/plain", body: { data: b64("Hello Anna here.\n> quoted older text\nOn Mon, Bob wrote:\nold") } } },
            { id: sentHex, threadId: hex, labelIds: ["SENT"], snippet: "Thanks", internalDate: when(recent), payload: { headers: [header("From", "me@example.com"), header("Subject", "Re: Invoice")], mimeType: "text/plain", body: { data: b64("Thanks, paid.\n> Hello Anna here.") } } },
          ],
        });
      if (p === `/gmail/v1/users/me/messages/${hex}` && u.searchParams.get("format") === "full")
        return json(200, { id: hex, threadId: hex, payload: { mimeType: "multipart/mixed", parts: [{ mimeType: "text/plain", body: { data: b64("x") } }, { partId: "1", mimeType: "application/pdf", filename: "invoice.pdf", body: { attachmentId: "att1", size: 4 } }] } });
      if (p === `/gmail/v1/users/me/messages/${hex}/attachments/att1`) return json(200, { data: b64("%PDF"), size: 4 });
      if (p === "/calendar/v3/users/me/calendarList")
        return json(200, { items: [{ id: "me@example.com", summary: "Work", backgroundColor: "#16a765", selected: true }, { id: "hidden@example.com", summary: "Hidden", selected: false }] });
      if (p === "/calendar/v3/calendars/me%40example.com/events") {
        const day = new Date();
        day.setHours(0, 0, 0, 0);
        const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        const next = new Date(day);
        next.setDate(next.getDate() + 1);
        const at = new Date(day);
        at.setHours(9, 0, 0, 0);
        const until = new Date(day);
        until.setHours(10, 30, 0, 0);
        return json(200, {
          items: [
            { id: "ev1", status: "confirmed", summary: "Standup", location: "Room 1", htmlLink: "https://calendar.google.com/event?eid=x", hangoutLink: "https://meet.google.com/abc", start: { dateTime: at.toISOString() }, end: { dateTime: until.toISOString() }, organizer: { email: "boss@example.com" }, attendees: [{ email: "me@example.com", self: true, responseStatus: "accepted" }, { displayName: "Boss", email: "boss@example.com" }] },
            { id: "ev2", status: "confirmed", summary: "Holiday", start: { date: ymd(day) }, end: { date: ymd(next) } },
            { id: "ev3", status: "cancelled", summary: "Gone", start: { date: ymd(day) }, end: { date: ymd(next) } },
          ],
        });
      }
      return json(404, { error: { message: "not found" } });
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.ZEFF_GOOGLE_API_URL = base;
  process.env.ZEFF_GOOGLE_TOKEN_URL = `${base}/token`;
  return { seen, base, close: () => server.close() };
}

async function signIn(accessToken: string) {
  const { updateConnector } = await import("@/lib/connectors/store");
  updateConnector("google", { authKind: "oauth", clientId: "app", clientSecret: "sec", refreshToken: "r1", accessToken, expiresAt: Date.now() + 3600e3 });
  updateConnector("gmail", { driver: "api" });
  updateConnector("gcalendar", { driver: "api" });
  // Only Gmail among the mail plugins (Outlook would want the Chrome).
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("gmail", true);
  setInstalled("outlook-mail", false);
}

test("with the API driver Gmail syncs without the automation Chrome", async () => {
  const g = await fakeGoogle();
  try {
    await signIn("good");
    const { getDb, schema } = await import("@/db");
    const { syncMail } = await import("@/lib/mail/sync");
    const { getPref } = await import("@/lib/prefs");
    // A "background" sync works although no automation Chrome runs: nothing here needs it.
    const r = await syncMail({ background: true });
    assert.equal(r.ok, true, r.message);
    assert.doesNotMatch(r.message, /later/);
    const rows = getDb().select().from(schema.emails).all();
    const inbox = rows.find((m) => m.subject === "Invoice")!;
    assert.equal(inbox.folder, "Gmail");
    assert.equal(inbox.convId, `gmail:${hex}`);
    assert.equal(inbox.fromName, "Anna Beispiel");
    assert.equal(inbox.fromEmail, "anna@example.com");
    assert.equal(inbox.unread, true);
    assert.equal(inbox.hasAttachments, true);
    assert.equal(inbox.attachRef, `msg-f:${decimal(hex)}`);
    // The conversation is whole, its full text read (quotes cut): yours as "Ich".
    assert.equal(inbox.preview, "Hello Anna here.");
    const mine = rows.find((m) => m.subject === "Re: Invoice")!;
    assert.equal(mine.fromName, "Ich");
    assert.equal(mine.unread, false);
    assert.equal(mine.preview, "Thanks, paid.");
    assert.ok(getPref<string[]>("gmail:full:0", []).includes(`msg-f:${decimal(sentHex)}`), "full text is remembered");
    assert.ok(g.seen.every((s) => s.method === "GET" && (s.url === "/token" || s.auth === "Bearer good")));
    // The second time the known full texts are not read again (the thread isn't asked for text twice — the id is in fullKnown).
    const { listAttention } = await import("@/lib/attention");
    assert.ok(!(await listAttention()).some((a) => a.key === "login:gmail"));
  } finally {
    g.close();
  }
});

test("with the API driver the attachments of a mail are fetched through the API", async () => {
  const g = await fakeGoogle();
  try {
    await signIn("good");
    const { gmailApiCall } = await import("@/lib/google/gmail-api");
    const ref = `msg-f:${decimal(hex)}`;
    const listed = (await gmailApiCall("gmail_attachments", { ref })) as { attachments: { id: string; name: string; mime: string; size: number }[] };
    assert.deepEqual(listed.attachments.map((a) => [a.name, a.mime]), [["invoice.pdf", "application/pdf"]]);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zeff-gatt-"));
    const got = (await gmailApiCall("gmail_download", { ref, ids: ["0"], dir })) as { files: { path: string; name: string }[] };
    assert.equal(got.files.length, 1);
    assert.equal(fs.readFileSync(got.files[0].path, "utf8"), "%PDF");
    fs.rmSync(dir, { recursive: true, force: true });
  } finally {
    g.close();
  }
});

test("with the API driver Google Calendar writes its calendars and events", async () => {
  const g = await fakeGoogle();
  try {
    await signIn("good");
    const { syncGoogleCalendar } = await import("@/plugins/google-calendar/sync");
    const r = await syncGoogleCalendar({ background: true });
    assert.equal(r.ok, true, r.message);
    assert.match(r.message, /2 events in 2 calendars/);
    const { getDb, schema } = await import("@/db");
    const cals = getDb().select().from(schema.calendars).all();
    assert.deepEqual(cals.map((c) => c.key).sort(), ["google:hidden@example.com", "google:me@example.com"]);
    assert.equal(cals.find((c) => c.key === "google:hidden@example.com")!.visible, false);
    const events = getDb().select().from(schema.calendarEvents).all();
    assert.deepEqual(events.map((e) => e.title).sort(), ["Holiday", "Standup"]);
    const standup = events.find((e) => e.title === "Standup")!;
    assert.match(standup.start, /T09:00$/);
    assert.match(standup.end, /T10:30$/);
    assert.equal(standup.location, "Room 1");
    assert.equal(standup.online, true);
    assert.equal(standup.response, "accepted");
    assert.equal(events.find((e) => e.title === "Holiday")!.allDay, true);
    assert.equal(g.seen.filter((s) => s.url.includes("hidden")).length, 0, "a calendar hidden in Google isn't read");
  } finally {
    g.close();
  }
});

test("Google Calendar reads the last months by default (from the 1st, configurable) — and a month shown that lies before, besides", async () => {
  const g = await fakeGoogle();
  try {
    await signIn("good");
    const { syncGoogleCalendar, syncWindow } = await import("@/plugins/google-calendar/sync");
    const timeMins = () => g.seen.filter((s) => s.url.startsWith("/calendar/v3/calendars/me%40example.com/events")).map((s) => new URL(s.url, "http://x").searchParams.get("timeMin")!);
    const local = (day: string) => new Date(`${day}T00:00:00`).toISOString();
    assert.equal((await syncGoogleCalendar({ background: true })).ok, true);
    const w = syncWindow({ weeks: 5, pastMonths: 3 });
    const back = new Date();
    assert.deepEqual(timeMins(), [local(w.from)], "one read: the window");
    assert.equal(w.from, new Date(back.getFullYear(), back.getMonth() - 3, 1).toLocaleDateString("sv-SE"), "from the 1st, three months back");
    g.seen.length = 0;
    assert.equal((await syncGoogleCalendar({ background: true, range: { from: "2024-01-29", to: "2024-03-11" } })).ok, true);
    assert.deepEqual(timeMins(), [local(w.from), local("2024-01-29")], "the window, and the month shown");
  } finally {
    g.close();
  }
});

test("the window: the 1st of the month so many back (at least last week's Monday), so many weeks ahead; a range shown joined when it touches", async () => {
  const { syncWindow, rangesToRead } = await import("@/plugins/google-calendar/sync");
  const now = new Date(2026, 9, 22, 10); // Thursday 22 Oct 2026
  assert.deepEqual(syncWindow({ weeks: 5, pastMonths: 3 }, now), { from: "2026-07-01", to: "2026-11-16" });
  assert.deepEqual(syncWindow({ weeks: 5, pastMonths: 0 }, now), { from: "2026-10-01", to: "2026-11-16" });
  assert.deepEqual(syncWindow({ weeks: 1, pastMonths: 0 }, new Date(2026, 9, 3)), { from: "2026-09-21", to: "2026-09-28" }, "early in a month: last week's Monday is earlier");
  const w = { from: "2026-07-01", to: "2026-11-16" };
  assert.deepEqual(rangesToRead(w), [w]);
  assert.deepEqual(rangesToRead(w, { from: "2026-08-31", to: "2026-10-12" }), [w], "inside: nothing more");
  assert.deepEqual(rangesToRead(w, { from: "2026-05-25", to: "2026-07-06" }), [{ from: "2026-05-25", to: "2026-11-16" }], "touching: joined");
  assert.deepEqual(rangesToRead(w, { from: "2025-12-29", to: "2026-02-09" }), [w, { from: "2025-12-29", to: "2026-02-09" }], "apart: both");
});

test("an expired access token is refreshed once", async () => {
  const g = await fakeGoogle();
  try {
    await signIn("stale");
    const { getConnector } = await import("@/lib/connectors/store");
    const { readCalendar } = await import("@/lib/google/calendar-api");
    const r = await readCalendar({ from: "2026-10-01", to: "2026-10-15" });
    assert.equal(r.calendars.length, 2);
    assert.equal(getConnector("google").accessToken, "fresh");
    assert.equal(g.seen.filter((s) => s.url === "/token").length, 1);
  } finally {
    g.close();
  }
});

test("a refused Google sign-in says so and asks for no Chrome login", async () => {
  const g = await fakeGoogle();
  try {
    await signIn("revoked");
    // The token endpoint hands out the revoked one again: the sign-in is refused for good.
    const { updateConnector } = await import("@/lib/connectors/store");
    updateConnector("google", { accessToken: "revoked" });
    const refusing = http.createServer((_q, s) => (s.writeHead(200, { "content-type": "application/json" }), s.end(JSON.stringify({ access_token: "revoked", expires_in: 3600 }))));
    await new Promise<void>((r) => refusing.listen(0, "127.0.0.1", r));
    process.env.ZEFF_GOOGLE_TOKEN_URL = `http://127.0.0.1:${(refusing.address() as AddressInfo).port}/token`;
    try {
      const { syncMail } = await import("@/lib/mail/sync");
      const mail = await syncMail();
      assert.equal(mail.ok, false);
      assert.match(mail.message, /doesn't accept the sign-in/);
      const { syncGoogleCalendar } = await import("@/plugins/google-calendar/sync");
      const cal = await syncGoogleCalendar();
      assert.equal(cal.ok, false);
      assert.match(cal.message, /Connections page/);
      const { listAttention } = await import("@/lib/attention");
      const keys = (await listAttention()).map((a) => a.key);
      assert.ok(!keys.includes("login:gmail") && !keys.includes("login:gcalendar"));
    } finally {
      refusing.close();
    }
  } finally {
    g.close();
  }
});

test("a rate limit is waited out and the request asked again", async () => {
  process.env.ZEFF_API_RETRY_MS = "5";
  let calls = 0;
  const server = http.createServer((_req, res) => {
    calls++;
    const json = (code: number, v: unknown, h: Record<string, string> = {}) => (res.writeHead(code, { "content-type": "application/json", ...h }), res.end(JSON.stringify(v)));
    if (calls === 1) return json(429, { error: { message: "Too many" } });
    if (calls === 2) return json(403, { error: { errors: [{ reason: "userRateLimitExceeded" }], message: "User-rate limit exceeded." } });
    if (calls === 3) return json(403, { error: { errors: [{ reason: "forbidden" }], message: "nope" } });
    return json(200, { ok: true });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    process.env.ZEFF_GOOGLE_API_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    await signIn("good");
    const { apiRequest } = await import("@/lib/connectors/http");
    // 429, then 403 rate limit, then a real 403: two waits, and the real refusal comes back as it is.
    const r = await apiRequest("google", "/x");
    assert.equal(r.status, 403);
    assert.equal(calls, 3);
  } finally {
    server.close();
    delete process.env.ZEFF_API_RETRY_MS;
  }
});
