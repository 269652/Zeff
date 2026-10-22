import assert from "node:assert/strict";
import test from "node:test";
import { vnodeToString, type VNode } from "../src/plugins/workspace/card-template";
import type { Property, Row } from "../src/plugins/workspace/model";
import { renderView } from "../src/plugins/workspace/view-template";
import { DOCUMENTS_VIEW } from "../src/plugins/documents/view-template.meta";
import { docIdOf, documentsAppData } from "../src/plugins/documents/view-data";
import type { T } from "../src/lib/i18n/shared";

const t: T = (s, vars) => s.replace(/\{(\w+)\}/g, (_m, k: string) => String(vars?.[k] ?? `{${k}}`));
const now = new Date("2026-10-22T10:00:00");

// The documents database as the documents source makes it (workspace-source.ts).
const props: Property[] = [
  { id: "srcref", name: "Source", type: "text" },
  { id: "dockind", name: "Kind", type: "text" },
  { id: "docstatus", name: "Status", type: "text" },
  { id: "docadded", name: "Added", type: "date" },
  { id: "docsize", name: "Size (KB)", type: "number" },
  { id: "docunread", name: "Unread", type: "checkbox" },
  { id: "doccompiled", name: "Compiled", type: "checkbox" },
  { id: "docfrom", name: "From", type: "text" },
  { id: "docconcepts", name: "Concepts", type: "text" },
] as Property[];
const doc = (id: number, title: string, cells: Record<string, unknown>): Row => ({ id, title, icon: "", cells: { srcref: `doc:${id + 100}`, docstatus: "ready", docsize: 12, ...cells }, createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z" }) as Row;
const rows: Row[] = [
  doc(1, "Mahnung SKP.pdf", { dockind: "pdf", docadded: "2026-10-22T08:15", docunread: true, docsize: 2048, docfrom: "SKP — Ihre Mahnung", docconcepts: "Mahnung, Inkasso", doccompiled: true }),
  doc(2, "Urlaub.jpg", { dockind: "image", docadded: "2026-10-20T12:00", docsize: 900 }),
  doc(3, "Vertrag.docx", { dockind: "office", docadded: "2026-09-01T09:00", docstatus: "extracting", docunread: true }),
  doc(4, "Kaputt.pdf", { dockind: "pdf", docadded: "2026-08-01T09:00", docstatus: "failed" }),
  { id: 5, title: "a row of no document", icon: "", cells: {}, createdAt: "", updatedAt: "" },
];
const previews = { 1: [{ kind: "text" as const, text: "# Zahlungserinnerung über 120 Euro" }, { kind: "text" as const, text: "Bitte zahlen Sie bis Freitag." }] };

const find = (nodes: VNode[], tag: string): Extract<VNode, object>[] => nodes.flatMap((n) => (typeof n === "string" ? [] : [...(n.t === tag ? [n] : []), ...find(n.c, tag)]));
const app = (state: Record<string, string>, inTree = false) => documentsAppData(rows, { state, previews, t, now: now.getTime(), inTree, locale: "de-DE" });
const draw = (state: Record<string, string> = {}, inTree = false) =>
  renderView(DOCUMENTS_VIEW.defaultTemplate(t), { rows, props, titleName: "Name", state, app: app({ scope: "inbox", sort: "newest", layout: "grid", ...state }, inTree), db: { id: 3, title: "Dokumente" }, now, locale: "de-DE" }, { parts: DOCUMENTS_VIEW.parts, actions: DOCUMENTS_VIEW.actions });
const shownIds = (a: Record<string, unknown>) => (a.shown as Row[]).map((r) => r.id);

test("a document row's document: its id from the source reference", () => {
  assert.equal(docIdOf(rows[0]), 101);
  assert.equal(docIdOf(rows[4]), 0);
});

test("the scopes: the inbox the unread, the last 7 days, from mail, being read, a type — rows of no document left out", () => {
  assert.deepEqual(shownIds(app({ scope: "inbox" })), [1, 3]);
  assert.deepEqual(shownIds(app({ scope: "all" })), [1, 2, 3, 4]);
  assert.deepEqual(shownIds(app({ scope: "week" })), [1, 2]);
  assert.deepEqual(shownIds(app({ scope: "mail" })), [1]);
  assert.deepEqual(shownIds(app({ scope: "processing" })), [3], "being read: waiting or reading — a failed one is not");
  assert.deepEqual(shownIds(app({ scope: "kind:pdf" })), [1, 4]);
  assert.deepEqual(shownIds(app({})), [1, 3], "the inbox when nothing is set");
});

test("the search looks in the name, where it came from, the concepts and the text; the sorts", () => {
  assert.deepEqual(shownIds(app({ scope: "all", q: "inkasso" })), [1]);
  assert.deepEqual(shownIds(app({ scope: "all", q: "freitag" })), [1], "the preview's text");
  assert.deepEqual(shownIds(app({ scope: "all", q: "urlaub" })), [2]);
  assert.deepEqual(shownIds(app({ scope: "all", sort: "oldest" })), [4, 3, 2, 1]);
  assert.deepEqual(shownIds(app({ scope: "all", sort: "name" })), [4, 1, 2, 3]);
  assert.deepEqual(shownIds(app({ scope: "all", sort: "size" })), [1, 2, 3, 4]);
  assert.deepEqual(shownIds(app({ scope: "all", sort: "unread" })), [1, 3, 2, 4]);
});

test("the scopes as tab options with their counts; a type only while there is one of it", () => {
  const a = app({ scope: "all" });
  assert.equal(a.scopeOptions, "inbox:📥 Inbox 2, all:🗂️ All documents 4, week:🕑 Last 7 days 2, mail:✉️ From mail 1, processing:⏳ Being read 1, kind-pdf:📕 PDF 2, kind-office:📘 Office 1, kind-image:🖼️ Images 1");
  assert.equal(a.showScopes, true);
  assert.equal(app({}, true).showScopes, false, "the scopes in the Workspace tree");
});

test("the document picked (only while it is shown): its facts written out, the abstract, the concepts", () => {
  const a = app({ scope: "all", selected: "1" });
  assert.equal(a.hasPicked, true);
  const p = a.picked as Record<string, unknown>;
  assert.equal(p.id, 101);
  assert.equal(p.kind, "PDF");
  assert.equal(p.state, "Read and compiled");
  assert.equal(p.abstract, "Zahlungserinnerung über 120 Euro Bitte zahlen Sie bis Freitag.");
  assert.deepEqual(p.concepts, ["Mahnung", "Inkasso"]);
  assert.equal(app({ scope: "mail", selected: "2" }).hasPicked, false, "not in the scope");
});

test("the ticked ones counted (those of documents only); mark all read in a full inbox", () => {
  const a = app({ scope: "inbox", checked: "1,3,99" });
  assert.equal(a.checkedCount, 2);
  assert.equal(a.markAll, true);
  assert.equal(app({ scope: "all" }).markAll, false);
});

test("the default template draws without an error — every scope, both layouts, a document picked, some ticked, in the tree", () => {
  const states: Record<string, string>[] = [{}, { scope: "all" }, { scope: "all", layout: "list" }, { scope: "all", selected: "1" }, { scope: "all", selected: "2", layout: "list" }, { scope: "all", checked: "1,2" }, { scope: "mail", q: "nichts" }, { scope: "kind:pdf", busy: "true" }];
  for (const s of states) assert.deepEqual(draw(s).errors, [], JSON.stringify(s));
  assert.deepEqual(draw({}, true).errors, [], "in the tree");
});

test("built of the language: the scopes, sort and layout bound to the state; the documents as cards or a list; parts where it takes more", () => {
  const r = draw({ scope: "all" });
  assert.equal(r.state.scope, "all");
  assert.equal(find(r.nodes, "tabs").find((x) => x.a.bind === "scope")?.a.current, "all");
  assert.ok(find(r.nodes, "tabs").some((x) => x.a.bind === "layout"));
  assert.ok(find(r.nodes, "select").some((x) => x.a.bind === "sort"));
  assert.ok(find(r.nodes, "search").some((x) => x.a.bind === "q"));
  const cards = find(r.nodes, "cards")[0];
  assert.deepEqual(cards.c.map((x) => (typeof x === "string" ? x : x.a.row)), ["1", "2", "3", "4"], "a card per document, each its row (picked on a click)");
  assert.equal(cards.a.select, "true");
  const first = vnodeToString(cards.c[0]);
  assert.match(first, /<b>Mahnung SKP\.pdf<\/b>/, "unread: bold");
  assert.match(first, /2 MB · 08:15/, "its size, today: the time");
  assert.match(first, /✉ SKP — Ihre Mahnung/);
  assert.match(vnodeToString(cards.c[2]), /reading …/);
  assert.match(vnodeToString(cards.c[3]), /failed/);
  assert.deepEqual(find(cards.c, "part").filter((p) => p.a.name === "documents.thumb").length, 4);
  assert.deepEqual(find(cards.c, "part").filter((p) => p.a.name === "documents.check").map((p) => p.a.row), ["1", "2", "3", "4"]);
  assert.ok(find(r.nodes, "part").some((p) => p.a.name === "documents.add"));
  assert.equal(find(r.nodes, "selected").length, 0, "nothing picked: no preview");

  const list = find(draw({ scope: "all", layout: "list" }).nodes, "list")[0];
  assert.equal(list.c.length, 4);
  assert.match(vnodeToString(list.c[0]), /📕/);
});

test("the preview: the PDF in a frame (else the picture), the file's buttons, the facts, the concepts as searches", () => {
  const r = draw({ scope: "all", selected: "1" });
  const sel = find(r.nodes, "selected")[0];
  assert.equal(sel.a.row, "1");
  const parts = find(sel.c, "part").map((p) => p.a.name);
  assert.ok(parts.includes("documents.pdf") && parts.includes("documents.file"));
  const buttons = find(sel.c, "button");
  assert.ok(buttons.some((b) => b.a.action === "documents.read"), "unread: mark read");
  assert.ok(buttons.some((b) => b.a.action === "open"), "its page");
  assert.ok(buttons.some((b) => b.a.action === "documents.delete"));
  assert.deepEqual(buttons.filter((b) => b.a.action === "documents.find").map((b) => b.a.value), ["Mahnung", "Inkasso"]);
  const text = vnodeToString(sel.c);
  assert.match(text, /Read and compiled/);
  assert.match(text, /<part name=documents.text/, "the summary and the whole text: a part that loads them");
  const image = find(draw({ scope: "all", selected: "2" }).nodes, "selected")[0];
  assert.deepEqual(find(image.c, "part").filter((p) => p.a.name === "documents.thumb").map((p) => p.a.big), ["true"]);
  assert.ok(find(image.c, "button").some((b) => b.a.action === "documents.unread"), "read: mark unread");
});

test("several ticked: the bar of what to do with them instead of the search; an empty scope says so", () => {
  const r = draw({ scope: "all", checked: "1,2" });
  const actions = find(r.nodes, "button").map((b) => b.a.action);
  for (const a of ["documents.read", "documents.unread", "documents.delete"]) assert.ok(actions.includes(a), a);
  assert.match(vnodeToString(r.nodes), /2 selected/);
  assert.equal(find(r.nodes, "search").length, 0);
  assert.match(vnodeToString(draw({ scope: "mail", q: "nichts" }).nodes), /Nothing matches\./);
  assert.equal(find(draw({}, true).nodes, "tabs").filter((x) => x.a.bind === "scope").length, 0, "in the tree: no scope tabs");
});
