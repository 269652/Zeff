import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "zeff-folder-"));
const write = (dir: string, rel: string, text: string, mtime?: Date) => {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
  if (mtime) fs.utimesSync(p, mtime, mtime);
  return p;
};

test("a folder added: its documents read in — subfolders too; hidden files, Office's temp files and unknown kinds left out", async () => {
  const dir = tmp();
  write(dir, "rechnung.txt", "Rechnung Nr. 1");
  write(dir, "unter/notiz.md", "# Notiz");
  write(dir, ".versteckt.txt", "nein");
  write(dir, "~$offen.docx", "nein");
  write(dir, "programm.exe", "nein");
  write(dir, ".git/config.txt", "nein");
  const f = await import("@/plugins/documents/folders");
  const folder = f.addFolder(dir, "auto");
  const r = await f.scanFolders();
  assert.equal(r.added, 2, JSON.stringify(r));
  const names = f.folderFiles(folder.id).map((x) => x.rel).sort();
  assert.deepEqual(names, ["rechnung.txt", path.join("unter", "notiz.md")]);
  const again = await f.scanFolders();
  assert.equal(again.added + again.updated, 0, "nothing new the second time");
});

test("a file changed: its document updated in place (read and compiled again); deleted: marked as gone from the folder, kept", async () => {
  const dir = tmp();
  const p = write(dir, "plan.txt", "Version 1", new Date("2026-11-01T10:00:00Z"));
  const f = await import("@/plugins/documents/folders");
  const store = await import("@/plugins/documents/store");
  const folder = f.addFolder(dir, "auto");
  await f.scanFolders();
  const [entry] = f.folderFiles(folder.id);
  store.setExtracted(entry.docId!, "Version 1");
  write(dir, "plan.txt", "Version 2 — länger", new Date("2026-11-02T10:00:00Z"));
  const r = await f.scanFolders();
  assert.equal(r.updated, 1);
  const doc = store.getDocument(entry.docId!)!;
  assert.equal(doc.status, "queued", "to be read again");
  assert.equal(f.folderFiles(folder.id)[0].docId, entry.docId, "the same document");
  fs.rmSync(p);
  const gone = await f.scanFolders();
  assert.equal(gone.missing, 1);
  assert.ok(f.folderFiles(folder.id)[0].missingAt, "marked gone");
  assert.ok(store.getDocument(entry.docId!), "the document stays");
  assert.ok(f.localOrigins().get(entry.docId!)?.missing, "shown as gone from its folder");
});

test("a folder that waits for you: the text is read, but nothing with the AI (compiling, todos, reading scans) until you confirm", async () => {
  const dir = tmp();
  write(dir, "vertrag.txt", "Vertrag mit Frist");
  const f = await import("@/plugins/documents/folders");
  const gate = await import("@/plugins/documents/gate");
  const store = await import("@/plugins/documents/store");
  const { documentDocs } = await import("@/plugins/documents/export");
  f.addFolder(dir, "confirm");
  await f.scanFolders();
  const id = f.folderFiles(f.listFolders().find((x) => x.path === path.resolve(dir))!.id)[0].docId!;
  store.setExtracted(id, "Vertrag mit Frist");
  assert.equal(gate.isPending(id), true);
  assert.equal(documentDocs("http://z").some((d) => d.id.endsWith(`:${id}`)), false, "not to the knowledge server");
  assert.equal(store.uncompiledDocuments().includes(id), false);
  assert.equal(store.readableDocuments().some((d) => d.id === id), false, "not for the AI steps");
  gate.approve([id]);
  assert.equal(gate.isPending(id), false);
  assert.equal(documentDocs("http://z").some((d) => d.id.endsWith(`:${id}`)), true);
  assert.equal(store.readableDocuments().some((d) => d.id === id), true);
});

test("an automatic folder: no confirmation needed", async () => {
  const dir = tmp();
  write(dir, "a.txt", "A");
  const f = await import("@/plugins/documents/folders");
  const gate = await import("@/plugins/documents/gate");
  const folder = f.addFolder(dir, "auto");
  await f.scanFolders();
  assert.equal(gate.isPending(f.folderFiles(folder.id)[0].docId!), false);
});

test("folders: a path that isn't a folder is refused, the same one twice is one; the mode can change; removed, its documents stay", async () => {
  const f = await import("@/plugins/documents/folders");
  assert.throws(() => f.addFolder(path.join(tmp(), "gibt-es-nicht"), "auto"));
  const dir = tmp();
  const a = f.addFolder(dir, "auto");
  const b = f.addFolder(dir + path.sep, "confirm");
  assert.equal(a.id, b.id);
  f.setFolderMode(a.id, "confirm");
  assert.equal(f.listFolders().find((x) => x.id === a.id)?.mode, "confirm");
  f.removeFolder(a.id);
  assert.equal(f.listFolders().some((x) => x.id === a.id), false);
});

test("the folder browser: a folder's subfolders, hidden ones left out", async () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, "Rechnungen"));
  fs.mkdirSync(path.join(dir, ".cache"));
  write(dir, "datei.txt", "x");
  const f = await import("@/plugins/documents/folders");
  const l = f.browse(dir);
  assert.deepEqual(l.dirs.map((d) => d.name), ["Rechnungen"]);
  assert.equal(l.path, path.resolve(dir));
  assert.ok(f.browse(null).dirs.length > 0, "the roots (drives)");
});

test("a drive's root stays the root (\"C:\" alone would be the current folder on that drive)", async () => {
  if (process.platform !== "win32") return;
  const f = await import("@/plugins/documents/folders");
  const root = path.parse(process.cwd()).root; // e.g. C:\
  const l = f.browse(root);
  assert.equal(l.path, root);
  assert.equal(l.parent, null);
  assert.equal(f.browse(root.replace(/[\\/]$/, "")).path, root, "“C:” is the root too");
});

test("no local folders set up: the sync step isn't there — not listed, not run, never 'not running'", async () => {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("documents", true);
  const { setPref } = await import("@/lib/prefs");
  setPref("documents:folders", []);
  const reg = await import("@/lib/sync/registry");
  assert.ok(!reg.syncOverview().steps.some((s) => s.key === "localdocs"), "not listed without folders");
  setPref("documents:folders", [{ id: "x", path: os.tmpdir(), mode: "confirm", addedAt: "", lastScanAt: null, files: 0 }]);
  assert.ok(reg.syncOverview().steps.some((s) => s.key === "localdocs"), "listed once there is one");
  setPref("documents:folders", []);
});
