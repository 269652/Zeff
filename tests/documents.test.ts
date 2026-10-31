import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import zlib from "node:zlib";
import { setupTempData } from "./helpers";

setupTempData();

/** A zip with the given files (deflated) — what Office files are made of. */
function makeZip(files: Record<string, string>): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = zlib.deflateRawSync(Buffer.from(content, "utf8"));
    const nameBuf = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    parts.push(local, nameBuf, data);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(content.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cdBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cdBuf, end]);
}

const made: string[] = [];
// The folders are gone when the run ends (they used to pile up in the temp folder).
process.on("exit", () => made.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
const tmp = (name: string, data: string | Buffer) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zeff-doc-test-"));
  made.push(dir);
  const f = path.join(dir, name);
  fs.writeFileSync(f, data);
  return f;
};

test("documents: kinds by name and type", async () => {
  const { kindOf } = await import("@/plugins/documents/shared");
  assert.equal(kindOf("Vertrag.PDF"), "pdf");
  assert.equal(kindOf("notes.md"), "text");
  assert.equal(kindOf("Rechnung.docx"), "office");
  assert.equal(kindOf("foto.jpeg"), "image");
  assert.equal(kindOf("Sprachnachricht.opus"), "audio");
  assert.equal(kindOf("archive.rar"), "other");
});

test("documents: text, HTML, RTF read; Office files read out of their zip", async () => {
  const { extractText } = await import("@/plugins/documents/extract");
  assert.equal(await extractText(tmp("a.txt", "Hallo Welt\n\n\n\nZweite Zeile"), "a.txt", "text"), "Hallo Welt\n\nZweite Zeile");
  assert.equal(await extractText(tmp("a.txt", Buffer.from("Gr\xfc\xdfe", "latin1")), "a.txt", "text"), "Grüße");
  assert.match(await extractText(tmp("a.html", "<html><head><style>p{}</style></head><body><p>Rechnung &amp; Mahnung</p><script>x()</script><p>Betrag 5 &euro;</p></body></html>"), "a.html", "text"), /^Rechnung & Mahnung\n+Betrag 5 €$/);
  assert.match(await extractText(tmp("a.rtf", String.raw`{\rtf1\ansi{\fonttbl{\f0 Arial;}}\f0 Gr\'fc\'dfe\par Zweite Zeile}`), "a.rtf", "text"), /Grüße\nZweite Zeile/);

  const docx = makeZip({ "word/document.xml": "<w:document><w:body><w:p><w:r><w:t>Mietvertrag</w:t></w:r></w:p><w:p><w:r><w:t>Frist: </w:t></w:r><w:r><w:t>3 Monate</w:t></w:r></w:p></w:body></w:document>" });
  assert.equal(await extractText(tmp("v.docx", docx), "v.docx", "office"), "Mietvertrag\nFrist: 3 Monate");

  const xlsx = makeZip({
    "xl/workbook.xml": '<workbook><sheets><sheet name="Ausgaben" sheetId="1" r:id="rId1"/></sheets></workbook>',
    "xl/sharedStrings.xml": "<sst><si><t>Posten</t></si><si><t>Miete</t></si></sst>",
    "xl/worksheets/sheet1.xml": '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>Betrag</t></is></c></row><row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><v>850</v></c></row></sheetData></worksheet>',
  });
  assert.equal(await extractText(tmp("a.xlsx", xlsx), "a.xlsx", "office"), "## Ausgaben\nPosten\tBetrag\nMiete\t850");

  const pptx = makeZip({ "ppt/slides/slide1.xml": "<p:sld><a:p><a:r><a:t>Titel</a:t></a:r></a:p><a:p><a:r><a:t>Punkt eins</a:t></a:r></a:p></p:sld>" });
  assert.equal(await extractText(tmp("a.pptx", pptx), "a.pptx", "office"), "## Slide 1\nTitel\nPunkt eins");

  const odt = makeZip({ "content.xml": "<office:text><text:p>Erster Absatz</text:p><text:p>Zweiter</text:p></office:text>" });
  assert.equal(await extractText(tmp("a.odt", odt), "a.odt", "office"), "Erster Absatz\nZweiter");
});

test("documents: a simple text PDF is read here; audio without a transcriber is unsupported", async () => {
  const { extractText, UnsupportedError, pdfText } = await import("@/plugins/documents/extract");
  const content = "BT /F1 18 Tf 30 120 Td (Mietvertrag Stockmattenweg 5) Tj 0 -20 Td [(K\\374ndigungsfrist) -300 (drei Monate)] TJ ET";
  const compressed = zlib.deflateSync(Buffer.from(content, "latin1")).toString("latin1");
  const pdf = `%PDF-1.4\n4 0 obj<</Filter/FlateDecode/Length ${compressed.length}>>stream\n${compressed}\nendstream\nendobj\n%%EOF`;
  assert.equal(pdfText(Buffer.from(pdf, "latin1")), "Mietvertrag Stockmattenweg 5\nKündigungsfrist drei Monate");
  assert.match(await extractText(tmp("v.pdf", Buffer.from(pdf, "latin1")), "v.pdf", "pdf"), /^Mietvertrag Stockmattenweg 5/);
  // Too little to trust (a scan's few stray strings): handed to the Claude CLI — a stand-in here (no Claude, no cost).
  const stray = zlib.deflateSync(Buffer.from("BT (Hi) Tj ET", "latin1")).toString("latin1");
  const scan = tmp("s.pdf", Buffer.from(`%PDF-1.4\n4 0 obj<</Filter/FlateDecode>>stream\n${stray}\nendstream\nendobj`, "latin1"));
  process.env.CLAUDE_CLI = path.join(process.cwd(), "tests", "fake-claude-json.mjs");
  process.env.FAKE_CLAUDE_OUTPUT = JSON.stringify({ text: "UNREADABLE: pdftoppm is not installed" });
  await assert.rejects(() => extractText(scan, "s.pdf", "pdf"), UnsupportedError);
  // …and what it reads is the text (a picture: the OCR text and what it shows).
  process.env.FAKE_CLAUDE_OUTPUT = JSON.stringify({ text: "Rechnung Nr. 4711\nBetrag: 186,83 EUR" });
  assert.equal(await extractText(tmp("r.png", "x"), "r.png", "image"), "Rechnung Nr. 4711\nBetrag: 186,83 EUR");
  await assert.rejects(() => extractText(tmp("s.mp3", "x"), "s.mp3", "audio"), /transcriber/i);
});

test("documents: the store keeps a file once, queues it, drops it from todos when deleted", async () => {
  const { addDocument, deleteDocument, docsByRefs, getDocument, listDocuments, setAbstract, setExtracted } = await import("@/plugins/documents/store");
  const { addManualTodo, addTodoContext, getTodo } = await import("@/lib/todos/store");
  const a = addDocument("Rechnung 4711.txt", Buffer.from("Badenova 186,83 EUR"), "text/plain");
  assert.equal(a.fresh, true);
  assert.equal(a.doc.status, "queued");
  assert.equal(a.doc.kind, "text");
  assert.equal(addDocument("kopie.txt", Buffer.from("Badenova 186,83 EUR")).fresh, false);
  assert.equal(listDocuments().length, 1);
  setExtracted(a.doc.id, "Badenova 186,83 EUR fällig am 16.10.");
  assert.equal(getDocument(a.doc.id)?.abstract, "Badenova 186,83 EUR fällig am 16.10.");
  assert.equal(getDocument(a.doc.id)?.compiled, false);
  setAbstract(a.doc.id, "Rechnung der Badenova über 186,83 EUR.", "Rechnung, Energie");
  assert.equal(getDocument(a.doc.id)?.abstract, "Rechnung der Badenova über 186,83 EUR.");
  assert.deepEqual(getDocument(a.doc.id)?.concepts, ["Rechnung", "Energie"]);

  const todo = addManualTodo({ ticket: "", text: "Rechnung prüfen" });
  addTodoContext(todo.id, [a.doc.ref], "", "Dokument");
  assert.deepEqual(getTodo(todo.id)?.refs, [a.doc.ref]);
  assert.equal(docsByRefs([a.doc.ref]).get(a.doc.ref)?.name, "Rechnung 4711.txt");
  deleteDocument(a.doc.id);
  assert.deepEqual(getTodo(todo.id)?.refs, []);
  assert.equal(listDocuments().length, 0);
});

/** Poppler (a scanned PDF's reader): found on the PATH, the install commands per machine, off / failed-before refuse without installing. */
test("documents: Poppler is found, installers are chosen per machine, nothing is installed when off or failed before", async () => {
  const { findPoppler, installers, ensurePoppler } = await import("@/plugins/documents/poppler");
  const { setPref } = await import("@/lib/prefs");

  // On the PATH.
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), "zeff-poppler-"));
  fs.writeFileSync(path.join(bin, process.platform === "win32" ? "pdftoppm.exe" : "pdftoppm"), "");
  const oldPath = process.env.PATH;
  process.env.PATH = bin;
  assert.equal(findPoppler(), bin);
  assert.equal(await ensurePoppler(), bin);
  process.env.PATH = oldPath;

  // Which package manager, where.
  assert.deepEqual(installers("win32", (c) => c === "winget").map((i) => i.name), ["winget"]);
  assert.deepEqual(installers("win32", () => true).map((i) => i.name), ["winget", "scoop"]);
  assert.deepEqual(installers("win32", () => false), []);
  assert.deepEqual(installers("darwin", (c) => c === "brew").map((i) => i.command), ["brew"]);
  assert.deepEqual(installers("linux", () => true), []);
  assert.ok(installers("win32", () => true)[0].args.includes("oschwartz10612.Poppler"));

  // Not there (skipped on a machine that has it): off → told, not installed; failed a moment ago → told, not tried again.
  process.env.PATH = "";
  if (findPoppler()) return;
  setPref("plugin:documents", { transcriber: "", autoInstall: false });
  await assert.rejects(() => ensurePoppler(), /Automatic installation is off/);
  setPref("plugin:documents", { transcriber: "", autoInstall: true });
  setPref("documents:poppler-failure", { at: new Date().toISOString(), reason: "winget: no network" });
  await assert.rejects(() => ensurePoppler(), /installation failed \(winget: no network\)/);
  process.env.PATH = oldPath;
});
