import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "zeff-explorer-"));
const write = (dir: string, rel: string, text: string, mtime?: Date) => {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
  if (mtime) fs.utimesSync(p, mtime, mtime);
  return p;
};

test("files are told apart by name: what the viewer shows, the editor's language, the address bar's crumbs, CSV rows", async () => {
  const s = await import("@/plugins/explorer/shared");
  assert.equal(s.viewKind("Notiz.MD"), "markdown");
  assert.equal(s.viewKind("liste.csv"), "csv");
  assert.equal(s.viewKind("app.tsx"), "text");
  assert.equal(s.languageOf("app.tsx"), "typescript");
  assert.equal(s.viewKind("foto.JPG"), "image");
  assert.equal(s.viewKind("brief.docx"), "office");
  assert.equal(s.viewKind("film.mp4"), "video");
  assert.equal(s.viewKind("setup.exe"), "none");
  assert.equal(s.viewKind(".gitignore"), "text");
  assert.deepEqual(
    s.crumbs("C:\\Users\\me\\Docs").map((c) => c.path),
    ["C:\\", "C:\\Users", "C:\\Users\\me", "C:\\Users\\me\\Docs"],
  );
  assert.deepEqual(s.crumbs("/home/me").map((c) => c.path), ["/", "/home", "/home/me"]);
  assert.equal(s.baseName("C:\\Users\\me\\"), "me");
  assert.deepEqual(s.parseCsv('a;b\n"x;1";2\r\n'), [["a", "b"], ["x;1", "2"]]);
  assert.deepEqual(s.parseCsv("a,b\n1,2"), [["a", "b"], ["1", "2"]]);
});

test("a folder listed: folders first, then files by name; hidden and system files left out; This PC lists the drives or /", async () => {
  const dir = tmp();
  write(dir, "b.txt", "B");
  write(dir, "A.md", "# A");
  write(dir, "zeta/inner.txt", "x");
  write(dir, ".hidden", "no");
  write(dir, "~$lock.docx", "no");
  write(dir, "desktop.ini", "no");
  const f = await import("@/plugins/explorer/files");
  const l = f.listDir(dir);
  assert.deepEqual(l.entries.map((e) => e.name), ["zeta", "A.md", "b.txt"]);
  assert.equal(l.entries[0].dir, true);
  assert.equal(l.entries[1].size, 3);
  assert.equal(l.parent, path.dirname(dir));
  assert.equal(l.watched, null);
  assert.ok(f.listDir(null).entries.length > 0, "the drives");
  assert.throws(() => f.listDir(path.join(dir, "missing")), /isn't there/);
  assert.throws(() => f.listDir(path.join(dir, "b.txt")), /a file, not a folder/);
});

test("a text file opened, edited and saved; saving is refused when the file changed on the disk meanwhile; a BOM is kept", async () => {
  const dir = tmp();
  const p = write(dir, "notes.md", "# Hello", new Date("2026-11-01T10:00:00Z"));
  const f = await import("@/plugins/explorer/files");
  const o = await f.openFile(p);
  assert.equal(o.view, "markdown");
  assert.equal(o.text, "# Hello");
  assert.equal(o.editable, true);
  assert.equal(o.importable, true);
  const saved = f.saveText(p, "# Hello again", o.mtime);
  assert.equal(fs.readFileSync(p, "utf8"), "# Hello again");
  // Changed by another program since it was opened: refused.
  write(dir, "notes.md", "changed elsewhere", new Date("2026-11-03T10:00:00Z"));
  assert.throws(() => f.saveText(p, "mine", saved.mtime), /changed on the disk/);
  // A BOM the file had stays.
  const bom = path.join(dir, "bom.txt");
  fs.writeFileSync(bom, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("alt")]));
  const b = await f.openFile(bom);
  assert.equal(b.text, "alt");
  f.saveText(bom, "neu", b.mtime);
  assert.deepEqual([...fs.readFileSync(bom).subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.equal(fs.readFileSync(bom).subarray(3).toString("utf8"), "neu");
  // Not UTF-8: shown, not editable; a picture or a program isn't text to save.
  const latin = path.join(dir, "alt.txt");
  fs.writeFileSync(latin, Buffer.from([0x47, 0x72, 0xfc, 0xdf, 0x65]));
  const l = await f.openFile(latin);
  assert.equal(l.editable, false);
  assert.equal(l.text, "Grüße");
  assert.throws(() => f.saveText(latin, "x", l.mtime), /Not UTF-8/);
  assert.throws(() => f.saveText(path.join(dir, "bild.png"), "x", 0), /Only text files/);
});

test("new folders and text files; names Windows refuses are refused; programs are never started", async () => {
  const dir = tmp();
  const f = await import("@/plugins/explorer/files");
  const sub = f.makeFolder(dir, "Rechnungen");
  assert.ok(fs.statSync(sub).isDirectory());
  assert.throws(() => f.makeFolder(dir, "Rechnungen"), /already there/);
  const file = f.makeTextFile(sub, "liste");
  assert.equal(path.basename(file), "liste.txt");
  assert.equal(fs.readFileSync(file, "utf8"), "");
  for (const bad of ["..", "a/b", "a\\b", "con", "x:y", "trailing."]) assert.throws(() => f.makeFolder(dir, bad), /can't be a file name/, bad);
  assert.throws(() => f.makeTextFile(dir, "tool.exe"), /Only text files/);
  write(dir, "run.bat", "echo hi");
  if (f.canOpenHere()) await assert.rejects(() => f.openHere(path.join(dir, "run.bat")), /aren't started/);
});

test("files imported into Documents: shown as there, the same content once, a changed file updates its document in place", async () => {
  const dir = tmp();
  const a = write(dir, "brief.txt", "Sehr geehrte Damen und Herren", new Date("2026-11-01T10:00:00Z"));
  const b = write(dir, "kopie.txt", "Sehr geehrte Damen und Herren");
  write(dir, "programm.exe", "MZ");
  const im = await import("@/plugins/explorer/imports");
  const f = await import("@/plugins/explorer/files");
  const store = await import("@/plugins/documents/store");
  const r = await im.importFiles([a, b, path.join(dir, "programm.exe")]);
  assert.equal(r.added, 1, JSON.stringify(r));
  assert.equal(r.same, 1, "the same content is kept once");
  assert.equal(r.skipped.length, 1, "a program isn't read");
  const listed = f.listDir(dir).entries.find((e) => e.name === "brief.txt")!;
  assert.equal(listed.docId, r.docIds[0]);
  assert.equal(listed.changed, false);
  // Imported again unchanged: nothing happens.
  assert.equal((await im.importFiles([a])).same, 1);
  // Changed: shown as changed; imported again, the same document is updated.
  write(dir, "brief.txt", "Sehr geehrte Damen und Herren, neu", new Date("2026-11-05T10:00:00Z"));
  assert.equal(f.listDir(dir).entries.find((e) => e.name === "brief.txt")!.changed, true);
  const again = await im.importFiles([a]);
  assert.equal(again.updated, 1);
  assert.equal(again.docIds[0], listed.docId);
  assert.equal(f.listDir(dir).entries.find((e) => e.name === "brief.txt")!.changed, false);
  // Deleted in Documents: the file shows as not imported.
  store.deleteDocument(listed.docId!);
  assert.equal(f.listDir(dir).entries.find((e) => e.name === "brief.txt")!.docId, null);
});

test("a folder imported once: its readable files, subfolders too, hidden ones left out", async () => {
  const dir = tmp();
  write(dir, "eins.txt", "eins");
  write(dir, "unter/zwei.md", "# zwei");
  write(dir, ".git/x.txt", "nein");
  write(dir, "bild.xyz", "nein");
  const im = await import("@/plugins/explorer/imports");
  const { files, cut } = im.readableFiles(dir);
  assert.equal(cut, false);
  assert.deepEqual(files.map((p) => path.relative(dir, p)).sort(), ["eins.txt", path.join("unter", "zwei.md")]);
});

test("a watched folder: listed in the side pane, the folders inside it know it; what the watcher ignores", async () => {
  const dir = tmp();
  write(dir, "sub/a.txt", "a");
  const folders = await import("@/plugins/documents/folders");
  const f = await import("@/plugins/explorer/files");
  const w = await import("@/plugins/explorer/watch");
  const added = folders.addFolder(dir, "confirm");
  assert.ok(f.places().watched.some((p) => p.id === added.id));
  assert.equal(f.listDir(path.join(dir, "sub")).watched?.id, added.id);
  assert.equal(f.listDir(path.dirname(dir)).watched, null);
  // Read in by the folder: the file shows as in Documents.
  await folders.scanFolders();
  assert.notEqual(f.listDir(path.join(dir, "sub")).entries[0].docId, null);
  for (const name of ["~$brief.docx", ".DS_Store", "x.tmp", "film.crdownload", "Thumbs.db"]) assert.equal(w.ignored(name), true, name);
  assert.equal(w.ignored("sub/brief.docx"), false);
  folders.removeFolder(added.id);
});

test("Explorer pages: made by the template, remembered with their folder; /explorer opens the first one", async () => {
  const pages = await import("@/plugins/explorer/pages");
  const { getPage } = await import("@/plugins/workspace/store");
  const id = pages.createExplorerPage(null, null);
  assert.equal(getPage(id)?.title, "Explorer");
  assert.equal(getPage(id)?.fullWidth, true);
  assert.equal(pages.isExplorerPage(id), true);
  pages.rememberPath(id, "C:\\Temp");
  assert.equal(pages.lastPath(id), "C:\\Temp");
  assert.equal(pages.explorerPage(), id);
  assert.equal(pages.isExplorerPage(id + 999), false);
});

test("an Explorer page's places in the Workspace tree: under the page when set so, each leading to its folder; off again: gone", async () => {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("explorer", true);
  const pages = await import("@/plugins/explorer/pages");
  const { appNavs } = await import("@/plugins/workspace/app-nav");
  const { pathOfNav } = await import("@/plugins/explorer/shared");
  const id = pages.createExplorerPage(null, null);
  assert.equal(pages.placesInTree(id), false);
  assert.equal((await appNavs())[id], undefined, "not in the tree until set so");
  pages.rememberPath(id, "C:\Temp");
  pages.setPlacesInTree(id, true);
  assert.equal(pages.lastPath(id), "C:\Temp", "the folder it was in stays");
  const nav = (await appNavs())[id];
  assert.ok(nav, "in the tree now");
  assert.equal(nav.fixed, true, "no Hide in the tree — the page's own switch");
  assert.ok(nav.entries.some((e) => e.group === "This PC"), "the drives");
  assert.ok(nav.entries.every((e) => pathOfNav(e.id) !== null && !e.href), "each a ?nav=path:… of the page");
  pages.setPlacesInTree(id, false);
  assert.equal((await appNavs())[id], undefined);
  assert.throws(() => pages.setPlacesInTree(id + 999, true), /isn't an Explorer page/);
});
