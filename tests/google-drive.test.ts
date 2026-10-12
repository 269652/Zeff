import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { setupTempData } from "./helpers";
import { startFakeGoogle, type FakeGoogle } from "./fake-google";

// The Google Drive plugin against a stand-in for Google (tests/fake-google.ts): OAuth, the two
// syncs it adds to Documents and Backups, and what stays off by default.
const dir = setupTempData();
process.env.ZEFF_DRIVE_CHUNK = "262144"; // (the smallest chunk Drive allows: big files go in several)
let google: FakeGoogle;

test.before(async () => {
  google = await startFakeGoogle();
  process.env.ZEFF_GOOGLE_AUTH_URL = `${google.url}/auth`;
  process.env.ZEFF_GOOGLE_TOKEN_URL = `${google.url}/token`;
  process.env.ZEFF_GOOGLE_API_BASE = google.url;
});
test.after(async () => {
  await google.close();
});

const folderIn = (parent: string, name: string) => google.childrenOf(parent).find((f) => f.name === name && f.mimeType === "application/vnd.google-apps.folder");
const rootFolder = () => [...google.files.values()].find((f) => f.name === "Zeff" && f.parents.includes("root"));

/** Signed in as the callback would leave it (through the real code exchange). */
async function connect(full = false) {
  const { updateDrive } = await import("@/plugins/google-drive/config");
  const { exchangeCode } = await import("@/plugins/google-drive/oauth");
  updateDrive({ clientId: "123.apps.googleusercontent.com", clientSecret: "shh" });
  google.state.scope = `openid email ${full ? "https://www.googleapis.com/auth/drive" : "https://www.googleapis.com/auth/drive.file"}`;
  await exchangeCode({ code: "the-code", redirectUri: "http://localhost:9333/api/google-drive/callback", verifier: "v" });
}

test("off until you set it up: nothing syncs, nothing is read from Drive, backups without a password stay home", async () => {
  const { driveRow } = await import("@/plugins/google-drive/config");
  const row = driveRow();
  assert.equal(row.pullDocuments, false, "Drive → Zeff is off by default");
  assert.equal(row.uploadUnencrypted, false);
  assert.equal(row.refreshToken, "", "not signed in");
  const { syncDocuments, syncBackups } = await import("@/plugins/google-drive/sync");
  assert.match((await syncDocuments()).message, /isn't connected/);
  assert.match((await syncBackups()).message, /isn't connected/);
  assert.equal(google.state.requests.length, 0, "Google was not asked anything");

  // As plugins: Documents' extension is on once the plugin is, Backups' stays off until you turn it on.
  const { setInstalled, stepAvailable } = await import("@/plugins/state");
  assert.equal(stepAvailable("drivedocs"), false, "the plugin isn't installed");
  setInstalled("documents", true);
  setInstalled("backup", true);
  setInstalled("google-drive", true);
  assert.equal(stepAvailable("drivedocs"), true, "Documents → Drive is on by itself");
  assert.equal(stepAvailable("drivebackup"), false, "Backups → Drive waits for you");
});

test("sign-in: the authorization URL asks for the narrowest access; the code is exchanged; the token is refreshed when it runs out", async () => {
  const { authorizeUrl, newPkce, newState, accessToken } = await import("@/plugins/google-drive/oauth");
  const { challenge } = newPkce();
  const narrow = new URL(authorizeUrl({ clientId: "c", redirectUri: "http://localhost/cb", state: newState(), challenge, full: false }));
  assert.equal(narrow.searchParams.get("scope"), "openid email https://www.googleapis.com/auth/drive.file");
  assert.equal(narrow.searchParams.get("code_challenge_method"), "S256");
  assert.equal(narrow.searchParams.get("access_type"), "offline");
  assert.match(new URL(authorizeUrl({ clientId: "c", redirectUri: "x", state: "s", challenge, full: true })).searchParams.get("scope")!, /auth\/drive$/);

  await connect();
  const { driveRow, isConnected, hasFullAccess } = await import("@/plugins/google-drive/config");
  assert.equal(isConnected(), true);
  assert.equal(driveRow().email, "me@example.com");
  assert.equal(hasFullAccess(), false, "only the files Zeff makes");
  const exchange = google.state.tokenRequests.at(-1)!;
  assert.equal(exchange.get("code_verifier"), "v");
  assert.equal(exchange.get("client_secret"), "shh");

  const first = await accessToken();
  assert.equal(first, google.state.valid);
  const before = google.state.tokenRequests.length;
  assert.equal(await accessToken(), first, "still good: no new request");
  assert.equal(google.state.tokenRequests.length, before);
});

test("Documents → Drive: each document goes up once — big ones in chunks, through a hiccup, after a refresh", async () => {
  const { addDocument } = await import("@/plugins/documents/store");
  addDocument("plan.txt", Buffer.from("the plan"), "text/plain");
  const big = Buffer.alloc(600 * 1024);
  crypto.randomFillSync(big);
  addDocument("scan.bin", big, "application/octet-stream");
  google.state.failChunkOnce = true; // the first chunk gets a 503: the upload asks how far it got, and goes on
  google.expireToken(); // the token has run out: a 401, a fresh token, the call again

  const { syncDocuments } = await import("@/plugins/google-drive/sync");
  const r = await syncDocuments();
  assert.equal(r.ok, true, r.message);
  assert.match(r.message, /2 uploaded/);

  const documents = folderIn(rootFolder()!.id, "Documents")!;
  const there = google.childrenOf(documents.id);
  assert.deepEqual(there.map((f) => f.name).sort(), ["plan.txt", "scan.bin"]);
  assert.equal(there.find((f) => f.name === "plan.txt")!.data.toString(), "the plan");
  assert.ok(there.find((f) => f.name === "scan.bin")!.data.equals(big), "the big file arrived whole");

  // Again: nothing to do, nothing sent twice.
  const uploads = () => google.state.requests.filter((x) => x === "POST /upload/drive/v3/files").length;
  const n = uploads();
  const again = await syncDocuments();
  assert.match(again.message, /in sync/);
  assert.equal(uploads(), n);
  const { driveCounts } = await import("@/plugins/google-drive/sync");
  assert.equal(driveCounts().documents, 2);
});

test("Drive → Zeff stays off: a file added in Drive isn't read; switched on without full access it says so; with it, it comes in once", async () => {
  const { driveRow, updateDrive } = await import("@/plugins/google-drive/config");
  const { syncDocuments } = await import("@/plugins/google-drive/sync");
  const { listDocuments } = await import("@/plugins/documents/store");
  const documents = folderIn(rootFolder()!.id, "Documents")!;
  google.addByHand("from-drive.txt", documents.id, Buffer.from("added in Drive"));
  const count = () => listDocuments().length;
  const before = count();

  await syncDocuments();
  assert.equal(count(), before, "off by default: nothing comes in");

  updateDrive({ pullDocuments: true });
  const narrow = await syncDocuments();
  assert.equal(count(), before, "no access to files Zeff didn't make");
  assert.match(narrow.message, /connect again/);

  // Signed in with all of Drive.
  await connect(true);
  assert.equal(driveRow().pullDocuments, true);
  const full = await syncDocuments();
  assert.equal(full.ok, true, full.message);
  assert.match(full.message, /1 came in/);
  assert.equal(count(), before + 1);
  const came = listDocuments().find((d) => d.name === "from-drive.txt")!;
  assert.ok(came);
  assert.ok(fs.existsSync(path.join(dir, "documents")), "kept like a dropped one");

  // Once: the same file isn't taken in again — nor are Zeff's own uploads (they were seen as pushed).
  assert.match((await syncDocuments()).message, /in sync/);
  assert.equal(count(), before + 1);

  // Edited in Drive: its new content is a new document (the old one stays).
  const file = google.childrenOf(documents.id).find((f) => f.name === "from-drive.txt")!;
  google.edit(file.id, Buffer.from("edited in Drive"));
  assert.match((await syncDocuments()).message, /1 came in/);
  assert.equal(count(), before + 2);

  // A Google Doc comes as the Office file it exports to; a folder is left alone.
  google.addByHand("Minutes", documents.id, Buffer.from("minutes"), "application/vnd.google-apps.document");
  google.addByHand("Sub", documents.id, Buffer.alloc(0), "application/vnd.google-apps.folder");
  await syncDocuments();
  assert.ok(listDocuments().some((d) => d.name === "Minutes.docx"));
  assert.ok(!listDocuments().some((d) => d.name === "Sub"));
});

test("a document deleted in Zeff stays in Drive — and isn't brought back", async () => {
  const { listDocuments, deleteDocument } = await import("@/plugins/documents/store");
  const { syncDocuments } = await import("@/plugins/google-drive/sync");
  const doc = listDocuments().find((d) => d.name === "plan.txt")!;
  deleteDocument(doc.id);
  const documents = folderIn(rootFolder()!.id, "Documents")!;
  await syncDocuments();
  assert.ok(google.childrenOf(documents.id).some((f) => f.name === "plan.txt"), "still in Drive");
  assert.ok(!listDocuments().some((d) => d.name === "plan.txt"), "not back in Zeff");
});

test("Backups → Drive: encrypted ones go up as they are made, the others stay home, the retention is mirrored — carefully", async () => {
  const backups = path.join(dir, "bk");
  fs.mkdirSync(backups, { recursive: true });
  const { updateAppSettings } = await import("@/lib/ai");
  updateAppSettings({ backupDir: backups });
  // A ZIP's first entry says if it is encrypted (flag bit 0): a stand-in header and some bytes.
  const zip = (encrypted: boolean, size: number) => {
    const b = Buffer.alloc(size, 7);
    b.writeUInt32LE(0x04034b50, 0);
    b.writeUInt16LE(encrypted ? 1 : 0, 6);
    return b;
  };
  const put = (name: string, encrypted: boolean, size = 1000) => fs.writeFileSync(path.join(backups, name), zip(encrypted, size));
  put("zeff-backup-2026-10-01_030000.zip", true, 700 * 1024);
  put("zeff-backup-2026-10-02_030000.zip", true);
  put("zeff-backup-2026-10-03_030000.zip", false);
  put("zeff-konto-other-backup-2026-10-03_030000.zip", true); // another account's: not ours
  fs.writeFileSync(path.join(backups, "zeff-backup-2026-10-04_030000.zip.part"), "half");

  const { syncBackups } = await import("@/plugins/google-drive/sync");
  const r = await syncBackups();
  assert.equal(r.ok, true, r.message);
  assert.match(r.message, /2 uploaded/);
  assert.match(r.message, /1 not uploaded: no password/);
  const folder = folderIn(rootFolder()!.id, "Backups")!;
  assert.deepEqual(google.childrenOf(folder.id).map((f) => f.name).sort(), ["zeff-backup-2026-10-01_030000.zip", "zeff-backup-2026-10-02_030000.zip"]);
  assert.equal(google.childrenOf(folder.id).find((f) => f.name.includes("10-01"))!.data.length, 700 * 1024, "the big one whole, in chunks");

  // Allowed: the one without a password goes too.
  const { updateDrive } = await import("@/plugins/google-drive/config");
  updateDrive({ uploadUnencrypted: true });
  assert.match((await syncBackups()).message, /1 uploaded/);

  // The retention removed the oldest here: it goes from Drive too — only what Zeff put there.
  const stranger = google.addByHand("my-own-file.zip", folder.id, Buffer.from("not Zeff's"));
  fs.rmSync(path.join(backups, "zeff-backup-2026-10-01_030000.zip"));
  const removed = await syncBackups();
  assert.match(removed.message, /1 removed/);
  assert.deepEqual(google.childrenOf(folder.id).map((f) => f.name).sort(), ["my-own-file.zip", "zeff-backup-2026-10-02_030000.zip", "zeff-backup-2026-10-03_030000.zip"]);
  assert.ok(google.files.has(stranger.id), "a file Zeff didn't put there is never touched");

  // The backup folder unreachable (nothing local at all): nothing is removed from Drive.
  const hidden = path.join(dir, "bk-away");
  fs.renameSync(backups, hidden);
  const gone = await syncBackups();
  assert.equal(gone.ok, true);
  assert.equal(google.childrenOf(folder.id).length, 3, "no deletions from an empty view");
  fs.renameSync(hidden, backups);

  // Mirroring off: Drive keeps what the retention removed.
  updateDrive({ mirrorBackupRetention: false });
  fs.rmSync(path.join(backups, "zeff-backup-2026-10-02_030000.zip"));
  await syncBackups();
  assert.equal(google.childrenOf(folder.id).length, 3);
});

/** Polls until `ok` (the syncs started by the Sync menu's step go on in the background). */
const until = async (what: string, ok: () => boolean | Promise<boolean>, ms = 15000) => {
  for (const end = Date.now() + ms; !(await ok()); ) {
    if (Date.now() > end) throw new Error(`Timed out waiting: ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
};

test("the Sync menu's steps run the syncs and record how they went; a backup that was just made goes up at once", async () => {
  const { setExtensionInstalled } = await import("@/plugins/extension-state");
  const { stepAvailable } = await import("@/plugins/state");
  const { startSync } = await import("@/lib/sync/registry");
  const { getDb, schema } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  const record = (key: string) => getDb().select().from(schema.syncState).where(eq(schema.syncState.key, key)).get();

  // The Backups extension is off until it is turned on.
  assert.equal(stepAvailable("drivebackup"), false);
  assert.equal(startSync("drivebackup").ok, false);
  setExtensionInstalled("google-drive:backup-sync", true);
  assert.equal(stepAvailable("drivebackup"), true);

  const { addDocument } = await import("@/plugins/documents/store");
  addDocument("late.txt", Buffer.from("added later"), "text/plain");
  assert.equal(startSync("drivedocs").ok, true);
  await until("the documents step's record", () => !!record("drivedocs")?.lastAt);
  assert.equal(record("drivedocs")!.lastOk, true);
  assert.match(record("drivedocs")!.lastMessage ?? "", /1 uploaded/);
  const documents = folderIn(rootFolder()!.id, "Documents")!;
  assert.ok(google.childrenOf(documents.id).some((f) => f.name === "late.txt"));

  // A real backup (with a password): the hook after it starts the backups step — no waiting for its turn.
  const { updateAppSettings } = await import("@/lib/ai");
  updateAppSettings({ backupPassword: "pw" });
  const { runBackup } = await import("@/plugins/backup/backup");
  const made = await runBackup();
  assert.equal(made.ok, true, made.message);
  const name = path.basename(made.file!);
  const backups = folderIn(rootFolder()!.id, "Backups")!;
  await until("the new backup in Drive", () => google.childrenOf(backups.id).some((f) => f.name === name));
  assert.ok(google.childrenOf(backups.id).find((f) => f.name === name)!.data.equals(fs.readFileSync(made.file!)), "the backup arrived whole");
});

test("a revoked sign-in says so; disconnecting keeps what Drive has (the same account again uploads nothing twice, another one starts over)", async () => {
  const { syncDocuments } = await import("@/plugins/google-drive/sync");
  const { accessToken } = await import("@/plugins/google-drive/oauth");
  google.expireToken();
  google.state.invalidGrant = true;
  await assert.rejects(() => accessToken(true), /no longer accepts the saved sign-in/);
  const r = await syncDocuments();
  assert.equal(r.ok, false);
  assert.match(r.message, /Connect again/);
  google.state.invalidGrant = false;

  const { disconnect, isConnected, driveFiles } = await import("@/plugins/google-drive/config");
  const filesBefore = google.files.size;
  const knownBefore = driveFiles("document").length;
  assert.ok(knownBefore > 0);
  disconnect();
  assert.equal(isConnected(), false);
  assert.equal(google.files.size, filesBefore, "Drive was not touched");
  assert.equal(driveFiles("document").length, knownBefore, "what Zeff knows is in Drive is kept");

  // The same account again: nothing goes up twice.
  const { exchangeCode } = await import("@/plugins/google-drive/oauth");
  await exchangeCode({ code: "again", redirectUri: "http://localhost:9333/api/google-drive/callback", verifier: "v" });
  const sameAccount = await syncDocuments();
  assert.match(sameAccount.message, /in sync/);
  assert.equal(google.files.size, filesBefore, "no duplicates in Drive");

  // Another Google account: its Drive has none of it — what Zeff recorded is dropped.
  const { updateDrive } = await import("@/plugins/google-drive/config");
  updateDrive({ email: "someone-else@example.com" });
  await exchangeCode({ code: "other", redirectUri: "http://localhost:9333/api/google-drive/callback", verifier: "v" });
  assert.equal(driveFiles("document").length, 0, "another account: the list starts over");
});
