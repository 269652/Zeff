import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

test("full-text search over the documents: every word somewhere in the whole text (not only the name), case ignored; the whole text and summary for the detail", async () => {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("documents", true);
  const { addDocument, setExtracted, setAbstract } = await import("@/plugins/documents/store");
  const a = addDocument("PXL_1.jpg", Buffer.from("a"), "image/jpeg").doc;
  setExtracted(a.id, "Stadt Freiburg — Personalausweis beantragt. Seriennummer L933466L23. Abholung nur mit Termin.");
  setAbstract(a.id, "Der Ausweis ist beantragt.", "Personalausweis");
  const b = addDocument("brief.pdf", Buffer.from("b"), "application/pdf").doc;
  setExtracted(b.id, "Rechnung über 40 € für den Strom.");
  const { documentsMatching, documentText } = await import("@/plugins/documents/fulltext");
  assert.deepEqual(documentsMatching("l933466l23"), [a.id], "a word deep in the text");
  assert.deepEqual(documentsMatching("Termin Freiburg"), [a.id], "every word");
  assert.deepEqual(documentsMatching("Termin Strom"), [], "not every word in one");
  assert.deepEqual(documentsMatching("strom"), [b.id]);
  assert.deepEqual(documentsMatching(""), []);
  assert.deepEqual(documentText(a.id), { text: "Stadt Freiburg — Personalausweis beantragt. Seriennummer L933466L23. Abholung nur mit Termin.", summary: "Der Ausweis ist beantragt." });
});

test("a database's search box finds rows by what their pages say (a document's whole text), not only their cells", async () => {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("workspace", true);
  const w = await import("@/plugins/workspace/store");
  const { markdownToDoc } = await import("@/plugins/workspace/doc");
  const db = w.createPage({ kind: "database", title: "Ablage" });
  const row = w.addRow(db, { title: "Scan" });
  w.updatePage(row, { content: markdownToDoc("Seriennummer L933466L23 — Abholung nur mit Termin.") as never });
  w.addRow(db, { title: "Anderes" });
  const { rowsMatching } = await import("@/plugins/workspace/row-search");
  assert.deepEqual(rowsMatching(db, "l933466"), [row], "a word by its beginning, on the page");
  assert.deepEqual(rowsMatching(db, "Termin Abholung"), [row]);
  assert.deepEqual(rowsMatching(db, ""), []);
});
