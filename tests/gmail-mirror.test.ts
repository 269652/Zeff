import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/** The Gmail folder follows Gmail like an IMAP mirror: what leaves the inbox (or a chosen label) there leaves it here, into the archive. */
const A = "18a2b3c4d5e6f701";
const B = "18a2b3c4d5e6f702";
const S = "18a2b3c4d5e6f703";
const hours = (h: number) => String(Date.now() - h * 3600e3);

async function fakeGmail() {
  const state = { inbox: [A, B], sent: [] as string[], labels: {} as Record<string, string[]> };
  const meta = (id: string, subject: string, from: string, ago: number) => ({ id, threadId: id, labelIds: ["INBOX"], snippet: subject, internalDate: hours(ago), payload: { headers: [{ name: "From", value: from }, { name: "Subject", value: subject }] } });
  const msgs: Record<string, unknown> = { [A]: meta(A, "Bestelldetails", "Flink <info@flink.com>", 5), [B]: meta(B, "Hallo", "Anna <anna@example.com>", 6), [S]: { ...meta(S, "Re: Hallo", "Ich <me@example.com>", 4), labelIds: ["SENT"] } };
  const server = http.createServer((req, res) => {
    const u = new URL(req.url ?? "/", "http://x");
    const json = (v: unknown) => (res.writeHead(200, { "content-type": "application/json" }), res.end(JSON.stringify(v)));
    if (u.pathname === "/token") return json({ access_token: "fresh", expires_in: 3600 });
    if (u.pathname === "/gmail/v1/users/me/labels") return json({ labels: [{ id: "Label_1", name: "notifications/Flink", type: "user" }] });
    if (u.pathname === "/gmail/v1/users/me/messages") {
      const q = u.searchParams.get("q") ?? "";
      const label = u.searchParams.get("labelIds");
      const ids = label ? (state.labels[label] ?? []) : q.startsWith("in:inbox") ? state.inbox : q.startsWith("in:sent") ? state.sent : [];
      return json(q.includes("has:attachment") ? {} : { messages: ids.map((id) => ({ id, threadId: id })) });
    }
    const m = /\/messages\/([0-9a-f]+)$/.exec(u.pathname);
    if (m && msgs[m[1]]) return json(msgs[m[1]]);
    res.writeHead(404, { "content-type": "application/json" });
    res.end("{}");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.ZEFF_GOOGLE_API_URL = base;
  process.env.ZEFF_GOOGLE_TOKEN_URL = `${base}/token`;
  return { state, close: () => server.close() };
}

async function signIn() {
  const { updateConnector } = await import("@/lib/connectors/store");
  updateConnector("google", { authKind: "oauth", clientId: "app", clientSecret: "sec", refreshToken: "r1", accessToken: "good", expiresAt: Date.now() + 3600e3 });
  updateConnector("gmail", { driver: "api" });
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("gmail", true);
  setInstalled("outlook-mail", false);
}

const folders = async () => {
  const { getDb, schema } = await import("@/db");
  return Object.fromEntries(getDb().select().from(schema.emails).all().map((r) => [r.subject, r.folder]));
};

test("a mail that leaves the inbox leaves the folder (to the archive); a chosen label is a folder of its own; nothing else moves", async () => {
  const g = await fakeGmail();
  try {
    await signIn();
    const { syncMail, GMAIL_LABELS_PREF } = await import("@/lib/mail/sync");
    const { setPref } = await import("@/lib/prefs");
    const { saveMails } = await import("@/lib/mail/store");
    // Kept before: your own mail in the folder (it never moves), and an old one from long ago that Gmail no longer has in the inbox.
    saveMails([
      { convId: "gmail:mine", folder: "Gmail", from: "Ich", fromEmail: null, subject: "Meine Antwort", preview: "x", receivedAt: new Date(Date.now() - 3600e3).toISOString(), unread: false },
      { convId: "gmail:old", folder: "Gmail", from: "Alt", fromEmail: "a@b.de", subject: "Uralt", preview: "x", receivedAt: new Date(Date.now() - 400 * 86400e3).toISOString(), unread: false },
    ]);
    assert.equal((await syncMail()).ok, true);
    let f = await folders();
    assert.equal(f["Bestelldetails"], "Gmail");
    assert.equal(f["Hallo"], "Gmail");
    // The agent tidied: A is out of the inbox (under a label that is not kept as a folder).
    g.state.inbox = [B];
    await syncMail();
    f = await folders();
    assert.equal(f["Bestelldetails"], "Gmail · Archive", "gone from the inbox: in the archive, still kept");
    assert.equal(f["Hallo"], "Gmail");
    assert.equal(f["Meine Antwort"], "Gmail · Sent", "your own mails are the sent folder's, not the inbox's");
    assert.equal(f["Uralt"], "Gmail · Archive", "however old: it is not in the inbox");
    // A mail you send is read into the sent folder.
    g.state.sent = [S];
    await syncMail();
    assert.equal((await folders())["Re: Hallo"], "Gmail · Sent");
    // The label is added by hand: its mails are the folder "Gmail/notifications/Flink".
    setPref(GMAIL_LABELS_PREF, ["notifications/Flink"]);
    g.state.labels.Label_1 = [A];
    await syncMail();
    f = await folders();
    assert.equal(f["Bestelldetails"], "Gmail/notifications/Flink");
    assert.equal(f["Hallo"], "Gmail");
    // Out of the label too: the archive again.
    g.state.labels.Label_1 = [];
    await syncMail();
    f = await folders();
    assert.equal(f["Bestelldetails"], "Gmail · Archive");
    // Back in the inbox: the inbox's folder.
    g.state.inbox = [A, B];
    await syncMail();
    assert.equal((await folders())["Bestelldetails"], "Gmail");
  } finally {
    g.close();
  }
});

test("a list cut off says nothing; a legacy mail stays while its conversation is in the folder; the archive is the folder's own", async () => {
  const { archiveGone, archiveOf, isArchiveFolder } = await import("@/lib/mail/mirror");
  const { saveMails, keyOf } = await import("@/lib/mail/store");
  const { getDb, schema } = await import("@/db");
  const at = (d: number) => new Date(Date.now() - d * 86400e3).toISOString();
  const row = (subject: string, d: number, conv = `gmail:${subject}`) => ({ convId: conv, folder: "Gmail", from: "X", fromEmail: "x@y.de", subject, preview: subject, receivedAt: at(d), unread: false });
  saveMails([row("eins", 1), row("zwei", 5), row("drei", 20), row("vier alt", 30, "gmail:thread-v")]);
  const folderOf = () => Object.fromEntries(getDb().select().from(schema.emails).all().map((r) => [r.subject, r.folder]));
  assert.equal(archiveGone({ read: { folder: "Gmail", complete: false, keys: [], convIds: [] } }), 0, "cut off: nothing moves");
  assert.equal(folderOf()["eins"], "Gmail");
  const keep = keyOf({ ...row("zwei", 5), id: "msg-f:1" });
  // (zwei is kept by its key — here by a stand-in with its own id — and "vier alt" by its conversation; the rest go)
  const k = getDb().select().from(schema.emails).all().find((r) => r.subject === "zwei")!.key;
  archiveGone({ read: { folder: "Gmail", complete: true, keys: [k, keep], convIds: ["gmail:thread-v"] } });
  const f = folderOf();
  assert.equal(f["eins"], "Gmail · Archive");
  assert.equal(f["zwei"], "Gmail");
  assert.equal(f["drei"], "Gmail · Archive");
  assert.equal(f["vier alt"], "Gmail", "its conversation is still in the folder");
  // Put back in the inbox: out of the archive again, however old.
  const kd = getDb().select().from(schema.emails).all().find((r) => r.subject === "drei")!.key;
  archiveGone({ read: { folder: "Gmail", complete: true, keys: [k, kd], convIds: ["gmail:thread-v"] } });
  assert.equal(folderOf()["drei"], "Gmail");
  assert.equal(archiveOf("Gmail/notifications/Flink"), "Gmail · Archive");
  assert.equal(archiveOf("Gmail · work"), "Gmail · work · Archive", "an account's own archive");
  assert.equal(isArchiveFolder("Gmail · Archive"), true);
  assert.equal(isArchiveFolder("Gmail"), false);
});
