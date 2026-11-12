import assert from "node:assert/strict";
import test, { after } from "node:test";
import { setupTempData } from "./helpers";

// The notebook's kernels: Python and Node.js sessions that keep their variables, Rust compiled cell by cell. Real processes —
// a language that is not installed on this machine is skipped. Code runs only while the switch is on, and without Zeff's secrets.
setupTempData();
// Where the sessions run is chosen by the environment: ZNB_TEST_MODE=host (default) or docker.
const MODE = process.env.ZNB_TEST_MODE === "docker" ? "docker" : "host";
process.env.ZEFF_TEST_TOKEN = "must-not-reach-the-session";

type Out = { output_type: string; name?: string; text?: string; data?: Record<string, unknown>; ename?: string; evalue?: string };

async function api() {
  const registered = await import("@/plugins/notebook/languages");
  void registered;
  const sessions = await import("@/plugins/notebook/sessions");
  const rt = await import("@/plugins/notebook/runtimes");
  const run = async (session: string, language: string, code: string, ms = 60000) => {
    const ex = sessions.startExecution({ session, language, code });
    const t0 = Date.now();
    for (;;) {
      const r = sessions.readExecution(ex.id);
      if (r.status && r.status !== "queued" && r.status !== "running") return { status: r.status, outputs: (sessions.readExecution(ex.id).outputs ?? []) as Out[], count: r.count };
      if (Date.now() - t0 > ms) throw new Error(`cell did not finish: ${code.slice(0, 40)}`);
      await new Promise((r2) => setTimeout(r2, 25));
    }
  };
  return { sessions, rt, run };
}
const text = (o: Out[], name = "stdout") => o.filter((x) => x.output_type === "stream" && x.name === name).map((x) => x.text).join("");

after(async () => (await import("@/plugins/notebook/sessions")).endAllSessions());

test("code does not run until the switch is on", async () => {
  const { sessions, rt } = await api();
  assert.equal(rt.notebookEnabled(), false);
  assert.throws(() => sessions.startExecution({ session: "p1", language: "python", code: "1" }), /switched off/);
  rt.setNotebookEnabled(true);
  assert.equal(rt.notebookEnabled(), true);
  assert.throws(() => sessions.startExecution({ session: "p1", language: "cobol", code: "1" }), /No such language/);
});

test("Python: variables live on, the last expression is a result, errors name the line, HTML displays, a runaway cell is stopped and the session stays", { timeout: 400000 }, async (t) => {
  const { rt, run, sessions } = await api();
  rt.setNotebookEnabled(true);
  rt.setModeOf("python", MODE);
  if ((await rt.languageStatuses()).find((r) => r.id === "python")?.where !== MODE) return t.skip(`Python cannot run in ${MODE} mode here`);
  const a = await run("py", "python", "x = 41\nprint('hi')\nx + 1");
  assert.equal(a.status, "ok");
  assert.equal(text(a.outputs), "hi\n");
  assert.equal(a.outputs.find((o) => o.output_type === "execute_result")?.data?.["text/plain"], "42");
  assert.equal(a.count, 1);
  const b = await run("py", "python", "y = x * 2\ny");
  assert.equal(b.outputs.find((o) => o.output_type === "execute_result")?.data?.["text/plain"], "82", "the second cell sees the first one's x");
  assert.equal(b.count, 2);
  const e = await run("py", "python", "def f():\n    return 1 / 0\nf()");
  assert.equal(e.status, "error");
  const err = e.outputs.find((o) => o.output_type === "error");
  assert.equal(err?.ename, "ZeroDivisionError");
  const h = await run("py", "python", "display(HTML('<b>fett</b>'))\nimport sys\nprint('warn', file=sys.stderr)");
  assert.equal(h.outputs.find((o) => o.output_type === "display_data")?.data?.["text/html"], "<b>fett</b>");
  assert.equal(text(h.outputs, "stderr"), "warn\n");
  const env = await run("py", "python", "import os\nprint('TOKEN' in ''.join(os.environ.keys()).upper(), os.environ.get('ZEFF_TEST_TOKEN'))");
  assert.equal(text(env.outputs), "False None\n", "the session sees no secrets of Zeff's environment");
  const sh = await run("py", "python", "!echo from-the-shell");
  assert.match(text(sh.outputs), /from-the-shell/);
  const vars = (await sessions.askSession("py", "python", "vars")) as { items?: { name: string; type: string }[] };
  assert.ok(vars.items?.some((v) => v.name === "x" && v.type === "int"));
  const comp = (await sessions.askSession("py", "python", "complete", { code: "pri", pos: 3 })) as { items?: string[] };
  assert.ok(comp.items?.includes("print"));
  // A cell that never ends is interrupted; the session and its variables stay.
  const ex = sessions.startExecution({ session: "py", language: "python", code: "while True:\n    pass" });
  await new Promise((r) => setTimeout(r, 600));
  sessions.interruptSession("py", "python");
  const t0 = Date.now();
  while (["queued", "running"].includes(sessions.readExecution(ex.id).status ?? "") && Date.now() - t0 < 20000) await new Promise((r) => setTimeout(r, 50));
  assert.equal(sessions.readExecution(ex.id).status, "aborted");
  const after2 = await run("py", "python", "x");
  assert.equal(after2.outputs.find((o) => o.output_type === "execute_result")?.data?.["text/plain"], "41");
});

test("Node.js: variables live on, await at the top, console, errors, a last expression is a result", { timeout: 240000 }, async (t) => {
  const { rt, run, sessions } = await api();
  rt.setNotebookEnabled(true);
  rt.setModeOf("node", MODE);
  if ((await rt.languageStatuses()).find((r) => r.id === "node")?.where !== MODE) return t.skip(`Node.js cannot run in ${MODE} mode here`);
  const a = await run("nd", "node", "const a = 2;\nlet b = [1, 2, 3];\nconsole.log('hallo', b.length);\na * 21");
  assert.equal(a.status, "ok");
  assert.equal(text(a.outputs), "hallo 3\n");
  assert.equal(a.outputs.find((o) => o.output_type === "execute_result")?.data?.["text/plain"], "42");
  const b = await run("nd", "node", "a + b.length");
  assert.equal(b.outputs.find((o) => o.output_type === "execute_result")?.data?.["text/plain"], "5");
  const w = await run("nd", "node", "const v = await new Promise((r) => setTimeout(() => r(7), 20));\nv * 6");
  assert.equal(w.outputs.find((o) => o.output_type === "execute_result")?.data?.["text/plain"], "42");
  const after = await run("nd", "node", "v");
  assert.equal(after.outputs.find((o) => o.output_type === "execute_result")?.data?.["text/plain"], "7", "a const written with await is a variable of the session");
  const e = await run("nd", "node", "null.foo");
  assert.equal(e.status, "error");
  assert.equal(e.outputs.find((o) => o.output_type === "error")?.ename, "TypeError");
  const d = await run("nd", "node", "display(display.html('<i>schief</i>'))");
  assert.equal(d.outputs.find((o) => o.output_type === "display_data")?.data?.["text/html"], "<i>schief</i>");
  const env = await run("nd", "node", "process.env.ZEFF_TEST_TOKEN");
  assert.equal(env.outputs.find((o) => o.output_type === "execute_result"), undefined, "no secrets of Zeff's environment");
  const vars = (await sessions.askSession("nd", "node", "vars")) as { items?: { name: string }[] };
  assert.ok(vars.items?.some((v) => v.name === "a"));
});

test("Rust: a cell is compiled and run, functions and imports stay for the next cell, a last expression is printed, errors name the line", { timeout: 400000 }, async (t) => {
  const { rt, run } = await api();
  rt.setNotebookEnabled(true);
  rt.setModeOf("rust", MODE);
  if ((await rt.languageStatuses()).find((r) => r.id === "rust")?.where !== MODE) return t.skip(`Rust cannot run in ${MODE} mode here`);
  const a = await run("rs", "rust", 'fn square(x: i32) -> i32 { x * x }\nprintln!("{}", square(6));', 120000);
  assert.equal(a.status, "ok", JSON.stringify(a.outputs));
  assert.equal(text(a.outputs), "36\n");
  const b = await run("rs", "rust", "let v = vec![1, 2, 3];\nsquare(v.iter().sum::<i32>())", 120000);
  assert.equal(b.status, "ok", JSON.stringify(b.outputs));
  assert.equal(text(b.outputs), "36\n", "square() from the cell before; the last expression is printed");
  const c = await run("rs", "rust", 'let n: i32 = "text";', 120000);
  assert.equal(c.status, "error");
  const err = c.outputs.find((o) => o.output_type === "error") as unknown as { ename: string; traceback: string[] };
  assert.equal(err.ename, "CompileError");
  assert.match(err.traceback.join("\n"), /line 1/);
  const d = await run("rs", "rust", "fn square(x: i32) -> i32 { x * x * x }\nsquare(2)", 120000);
  assert.equal(text(d.outputs), "8\n", "a function defined again replaces the old one");
});

test("Rust cells are split into items and body", async () => {
  const { splitRust, rustProgram, mergeItems, itemKey } = await import("@/plugins/notebook-rust/rust");
  const c = splitRust('use std::fmt;\nstruct P { x: i32 }\nimpl P { fn get(&self) -> i32 { self.x } }\nlet p = P { x: 3 };\nlet s = "a;b{";\np.get()');
  assert.equal(c.items.length, 3);
  assert.deepEqual(c.body, ["let p = P { x: 3 };", 'let s = "a;b{";']);
  assert.equal(c.tail, "p.get()");
  assert.match(rustProgram(c, []).source, /fn main\(\) \{[\s\S]*zeff_return!\(\{ p\.get\(\) \}\);/);
  assert.equal(itemKey("pub fn foo(a: i32) {}"), "fn:foo");
  assert.deepEqual(mergeItems(["fn a() {}", "struct B;"], ["fn a() { 1; }"]), ["struct B;", "fn a() { 1; }"]);
  assert.equal(splitRust("if x { 1 } else { 2 }").tail, null, "a block statement is not printed");
  assert.equal(splitRust("let c = 'x'; let l: &'static str = \"}\";").body.length, 2);
});

test("outputs are nbformat: streams merge, big output is cut off once", async () => {
  const { addMessage, MAX_OUTPUT_CHARS } = await import("@/plugins/notebook/outputs");
  const o: Parameters<typeof addMessage>[0] = [];
  addMessage(o, { t: "stream", name: "stdout", text: "a" }, 1);
  addMessage(o, { t: "stream", name: "stdout", text: "b" }, 1);
  addMessage(o, { t: "stream", name: "stderr", text: "c" }, 1);
  assert.deepEqual(o, [{ output_type: "stream", name: "stdout", text: "ab" }, { output_type: "stream", name: "stderr", text: "c" }]);
  addMessage(o, { t: "stream", name: "stdout", text: "x".repeat(MAX_OUTPUT_CHARS + 1) }, 1);
  assert.equal(addMessage(o, { t: "stream", name: "stdout", text: "more" }, 1), false);
  assert.equal(addMessage(o, { t: "stream", name: "stdout", text: "more" }, 1), false);
  assert.equal(o.filter((x) => x.output_type === "stream" && x.text.includes("[output cut off]")).length, 1);
});

test(".znb: a page is a Jupyter notebook with Zeff's blocks on top, and comes back whole; a plain .ipynb opens too", async () => {
  const { pageToNotebook, notebookToPage } = await import("@/plugins/notebook/format");
  const { docToMarkdown, markdownToDoc } = await import("@/plugins/workspace/doc");
  const outputs = [{ output_type: "stream", name: "stdout", text: "hi\n" }, { output_type: "execute_result", execution_count: 2, data: { "text/plain": "42", "text/html": "<b>42</b>" }, metadata: {} }];
  const doc = { type: "doc", content: [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Analyse" }] },
    { type: "paragraph", content: [{ type: "text", text: "Erst rechnen, dann zeigen." }] },
    { type: "codeCell", attrs: { language: "python", source: "x = 41\nx + 1", outputs: JSON.stringify(outputs), count: 2 } },
    { type: "codeCell", attrs: { language: "rust", source: "println!(\"hi\");", outputs: "", count: 0 } },
    { type: "table", attrs: { name: "Kosten", locked: true }, content: [{ type: "tableRow", content: [{ type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "A" }] }] }] }] },
    { type: "panel", attrs: { title: "Umsatz", desc: "", collapsed: false }, content: [{ type: "paragraph", content: [{ type: "text", text: "im Panel" }] }, { type: "codeCell", attrs: { language: "node", source: "1+1", outputs: "", count: 0 } }] },
  ] };
  const nb = pageToNotebook("Analyse", doc as never, { exportedAt: "2026-11-12T10:00:00Z" });
  assert.equal(nb.nbformat, 4);
  assert.equal(nb.nbformat_minor, 5);
  assert.deepEqual((nb.metadata.kernelspec as { name: string }).name, "python3", "Jupyter opens it as a Python notebook");
  assert.deepEqual(nb.cells.map((c) => c.cell_type), ["markdown", "code", "code", "markdown", "markdown"]);
  assert.ok(new Set(nb.cells.map((c) => c.id)).size === nb.cells.length, "every cell has an id of its own (nbformat 4.5)");
  const py = nb.cells[1];
  assert.equal([py.source].flat().join(""), "x = 41\nx + 1");
  assert.equal(py.execution_count, 2);
  assert.deepEqual((py.metadata.zeff as { language: string }).language, "python");
  assert.deepEqual((nb.cells[2].metadata.zeff as { language: string }).language, "rust");
  assert.match([nb.cells[3].source].flat().join(""), /\| A \|/, "a table stays readable as a Markdown table for Jupyter");
  assert.match([nb.cells[4].source].flat().join(""), /Zeff panel: Umsatz/, "a block Jupyter does not know has a plain note");
  // And back: nothing is lost.
  const back = notebookToPage(JSON.parse(JSON.stringify(nb)));
  assert.equal(back.title, "Analyse");
  const types = back.doc.content.map((n) => n.type);
  assert.deepEqual(types, ["heading", "paragraph", "codeCell", "codeCell", "table", "panel"]);
  assert.equal(back.doc.content[2].attrs?.source, "x = 41\nx + 1");
  assert.equal(JSON.parse(String(back.doc.content[2].attrs?.outputs))[1].data["text/plain"], "42");
  assert.equal(back.doc.content[3].attrs?.language, "rust");
  assert.deepEqual(back.doc.content[4].attrs, { name: "Kosten", locked: true }, "the table keeps its name and protection");
  assert.deepEqual(back.doc.content[5].content?.map((n) => n.type), ["paragraph", "codeCell"], "a code cell inside a panel stays inside it");
  assert.match(docToMarkdown(markdownToDoc("# x")), /# x/);

  // A notebook from Jupyter (no Zeff in it): outputs as lists of lines, the kernel's language.
  const jup = { nbformat: 4, nbformat_minor: 4, metadata: { language_info: { name: "python" }, kernelspec: { language: "python" } }, cells: [
    { cell_type: "markdown", metadata: {}, source: ["# Titel\n", "Text"] },
    { cell_type: "code", metadata: {}, execution_count: 3, source: ["import math\n", "math.pi"], outputs: [{ output_type: "stream", name: "stdout", text: ["a\n", "b\n"] }, { output_type: "execute_result", execution_count: 3, data: { "text/plain": ["3.14"] }, metadata: {} }, { output_type: "weird" }] },
    { cell_type: "raw", metadata: {}, source: "roh" },
  ] };
  const j = notebookToPage(jup, "Importiert");
  assert.equal(j.title, "Importiert");
  assert.deepEqual(j.doc.content.map((n) => n.type), ["heading", "paragraph", "codeCell", "codeBlock"]);
  const jo = JSON.parse(String(j.doc.content[2].attrs?.outputs)) as { output_type: string; text?: string; data?: Record<string, string> }[];
  assert.equal(jo.length, 2, "an output kind that is not known is left out");
  assert.equal(jo[0].text, "ab".replace("a", "a\n").replace("b", "b\n"), "a stream's lines are joined");
  assert.equal(jo[1].data?.["text/plain"], "3.14");
  assert.throws(() => notebookToPage({ cells: "no" }), /not a notebook/);
  assert.throws(() => notebookToPage({ nbformat: 3, cells: [] }), /format 4/);
});

test("a code cell is kept by the page: its language, code and outputs whole, a bad language made python, huge outputs dropped", async () => {
  const { sanitizeDoc, docToMarkdown, markdownToDoc, markdownEditable } = await import("@/plugins/workspace/doc");
  const doc = { type: "doc", content: [{ type: "codeCell", attrs: { language: "Node", source: "a\n:::\nb", outputs: JSON.stringify([{ output_type: "stream", name: "stdout", text: "x" }]), count: 3 } }] };
  const clean = sanitizeDoc(doc).content[0];
  assert.deepEqual(clean.attrs, { language: "node", source: "a\n:::\nb", outputs: JSON.stringify([{ output_type: "stream", name: "stdout", text: "x" }]), count: 3, name: "", inputs: "[]", result: "" });
  assert.equal(sanitizeDoc({ type: "doc", content: [{ type: "codeCell", attrs: { language: "../../etc", source: "x" } }] }).content[0].attrs?.language, "python");
  assert.equal(sanitizeDoc({ type: "doc", content: [{ type: "codeCell", attrs: { language: "python", source: "x", outputs: "x".repeat(1_600_000) } }] }).content[0].attrs?.outputs, "");
  assert.equal(sanitizeDoc({ type: "doc", content: [{ type: "codeCell", attrs: { language: "python", source: "x", outputs: '{"not":"a list"}' } }] }).content[0].attrs?.outputs, "");
  const md = docToMarkdown({ type: "doc", content: [clean] } as never);
  assert.match(md, /^:::code \{"language":"node","count":3\}$/m);
  const back = markdownToDoc(md).content[0];
  assert.equal(back.type, "codeCell");
  assert.equal(back.attrs?.source, "a\n:::\nb", "a line of the code that is just ::: survives");
  assert.equal(markdownEditable(doc), false, "a page with a code cell is not edited as plain Markdown");
});

// ---------------------------------------------------------------------------
// Code reaching Zeff (zeff.table, zeff.metrics …): nothing without a permission, asked while the cell runs, kept, the code goes on.
// ---------------------------------------------------------------------------
const cell = (text: string, header = false) => ({ type: header ? "tableHeader" : "tableCell", content: [{ type: "paragraph", ...(text ? { content: [{ type: "text", text }] } : {}) }] });
const row = (...c: string[]) => ({ type: "tableRow", content: c.map((x) => cell(x)) });
const head = (...c: string[]) => ({ type: "tableRow", content: c.map((x) => cell(x, true)) });
const pageDoc = {
  type: "doc",
  content: [
    { type: "table", attrs: { name: "Ausgaben" }, content: [head("Kategorie", "Betrag"), row("Wohnen", "850"), row("Essen", "63,40"), row("Essen", "41,50"), row("Summe", "=SUMME(B2:B4)")] },
    { type: "tablePipe", attrs: { name: "Pro Kategorie", from: "Ausgaben", steps: JSON.stringify([{ op: "filter", col: "Kategorie", cmp: "!=", value: "Summe" }, { op: "group", by: "Kategorie", agg: "sum", col: "Betrag", as: "Summe" }, { op: "sort", col: "Summe", dir: "desc" }]) } },
  ],
};

async function waitFor<T>(f: () => T | undefined | false, ms = 30000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = f();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("waited too long");
    await new Promise((r) => setTimeout(r, 25));
  }
}

test("a page's tables, calculations and transform results reach the code only with a permission: asked while the cell runs, kept, the code goes on", { timeout: 120000 }, async (t) => {
  const { sessions, rt } = await api();
  rt.setNotebookEnabled(true);
  rt.setModeOf("python", MODE);
  if ((await rt.languageStatuses()).find((r) => r.id === "python")?.where !== MODE) return t.skip(`Python cannot run in ${MODE} mode here`);
  const { createPage } = await import("@/plugins/workspace/store");
  const grants = await import("@/plugins/notebook/grants");
  const id = createPage({ title: "Analyse", content: pageDoc });
  const session = `page-${id}`;
  const finish = async (exId: string) => waitFor(() => { const r = sessions.readExecution(exId); return r.status && !["queued", "running"].includes(r.status) ? r : undefined; });

  assert.equal(grants.isGranted(id, "tables"), false);
  const ex = sessions.startExecution({ session, language: "python", code: "t = zeff.table('Ausgaben')\nprint(t.cols, len(t))\nprint(t.rows[-1])" });
  // The cell stops and asks.
  const ask = await waitFor(() => sessions.readExecution(ex.id).permissions?.[0]);
  assert.equal(ask.key, "tables");
  assert.equal(sessions.readExecution(ex.id).status, "running", "it waits, it has not failed");
  assert.equal(grants.isGranted(id, "tables"), false, "nothing is read before the answer");
  // Allowed: kept for this page, and the code goes on right away.
  assert.equal(sessions.answerPermission(ex.id, ask.id, "page"), true);
  const done = await finish(ex.id);
  assert.equal(done.status, "ok", JSON.stringify(done.outputs));
  assert.equal(text(done.outputs as Out[]), "['Kategorie', 'Betrag'] 4\n['Summe', 954.9]\n", "the formula cell is worked out; numbers are numbers");
  assert.equal(grants.isGranted(id, "tables"), true);
  assert.equal(grants.isGranted(id + 1, "tables"), false, "another page has not been allowed");

  // The next run does not ask again; a transform's result is a table like any.
  const ex2 = sessions.startExecution({ session, language: "python", code: "r = zeff.table('Pro Kategorie')\nprint(r.records())\nprint(zeff.tables())" });
  const done2 = await finish(ex2.id);
  assert.equal(done2.status, "ok", JSON.stringify(done2.outputs));
  assert.match(text(done2.outputs as Out[]), /\[\{'Kategorie': 'Wohnen', 'Summe': 850\}, \{'Kategorie': 'Essen', 'Summe': 104\.9\}\]/);
  assert.match(text(done2.outputs as Out[]), /'Pro Kategorie'/);

  // Refused: the code gets a PermissionError and nothing is kept.
  const ex3 = sessions.startExecution({ session, language: "python", code: "try:\n    zeff.metrics()\nexcept PermissionError as e:\n    print('refused:', e)" });
  const ask3 = await waitFor(() => sessions.readExecution(ex3.id).permissions?.[0]);
  assert.equal(ask3.key, "metrics");
  sessions.answerPermission(ex3.id, ask3.id, "deny");
  const done3 = await finish(ex3.id);
  assert.match(text(done3.outputs as Out[]), /refused: Permission denied/);
  assert.equal(grants.isGranted(id, "metrics"), false);

  // Allowed for every page: kept for all of them.
  const ex4 = sessions.startExecution({ session, language: "python", code: "print(type(zeff.metrics()).__name__)" });
  const ask4 = await waitFor(() => sessions.readExecution(ex4.id).permissions?.[0]);
  sessions.answerPermission(ex4.id, ask4.id, "always");
  assert.equal(text((await finish(ex4.id)).outputs as Out[]), "dict\n");
  assert.equal(grants.isGranted(id + 99, "metrics"), true);
  grants.revokeGrant("*", "metrics");
  assert.equal(grants.isGranted(id, "metrics"), false, "taken back");

  // A table that is not there says what is.
  const ex5 = sessions.startExecution({ session, language: "python", code: "zeff.table('Nope')" });
  const done5 = await finish(ex5.id);
  assert.equal(done5.status, "error");
  assert.match(JSON.stringify(done5.outputs), /no table or result .Nope. on this page \(there are: Ausgaben, Pro Kategorie/);
});

test("Node.js reaches Zeff the same way (await zeff.table …), and a cell that is stopped while it waits ends the question", { timeout: 120000 }, async (t) => {
  const { sessions, rt } = await api();
  rt.setNotebookEnabled(true);
  rt.setModeOf("node", MODE);
  if ((await rt.languageStatuses()).find((r) => r.id === "node")?.where !== MODE) return t.skip(`Node.js cannot run in ${MODE} mode here`);
  const { createPage } = await import("@/plugins/workspace/store");
  const grants = await import("@/plugins/notebook/grants");
  const id = createPage({ title: "Analyse 2", content: pageDoc });
  const session = `page-${id}`;
  const finish = async (exId: string) => waitFor(() => { const r = sessions.readExecution(exId); return r.status && !["queued", "running"].includes(r.status) ? r : undefined; });
  const ex = sessions.startExecution({ session, language: "node", code: "const t = await zeff.table('Ausgaben');\nconsole.log(t.cols.join('|'), t.length);\nt.records()[1]" });
  const ask = await waitFor(() => sessions.readExecution(ex.id).permissions?.[0]);
  sessions.answerPermission(ex.id, ask.id, "page");
  const done = await finish(ex.id);
  assert.equal(done.status, "ok", JSON.stringify(done.outputs));
  assert.equal(text(done.outputs as Out[]), "Kategorie|Betrag 4\n");
  assert.match(JSON.stringify((done.outputs as Out[]).find((o) => o.output_type === "execute_result")?.data), /Essen/);
  assert.equal(grants.isGranted(id, "tables"), true);
  // Stopped while it waits: the question is gone and the code gets a refusal.
  const ex2 = sessions.startExecution({ session, language: "node", code: "await zeff.metrics()" });
  await waitFor(() => sessions.readExecution(ex2.id).permissions?.[0]);
  sessions.interruptSession(session, "node");
  const done2 = await finish(ex2.id);
  assert.notEqual(done2.status, "ok");
  assert.equal(sessions.readExecution(ex2.id).permissions?.length, 0, "no question is left open");
});

// ---------------------------------------------------------------------------
// A cell has inputs and an output: what it takes in is handed to the code, what it returns is kept, published for widgets — and the
// code can write into Zeff, each kind of write with a permission set of its own.
// ---------------------------------------------------------------------------
async function runAsking(sessions: typeof import("@/plugins/notebook/sessions"), input: { session: string; language: string; code: string; inputs?: string[]; name?: string }, answers: Record<string, string>) {
  const ex = sessions.startExecution(input);
  const t0 = Date.now();
  for (;;) {
    const r = sessions.readExecution(ex.id);
    for (const q of r.permissions ?? []) sessions.answerPermission(ex.id, q.id, answers[q.key] ?? "deny");
    if (r.status && !["queued", "running"].includes(r.status)) return { ex, r: sessions.readExecution(ex.id) };
    if (Date.now() - t0 > 60000) throw new Error("cell did not finish");
    await new Promise((res) => setTimeout(res, 25));
  }
}

test("a cell's inputs reach its code, what it returns is its output — kept, and published for widgets under its name", { timeout: 180000 }, async (t) => {
  const { sessions, rt } = await api();
  rt.setNotebookEnabled(true);
  const { createPage } = await import("@/plugins/workspace/store");
  const { getOutput } = await import("@/plugins/workspace/widget-outputs");
  const id = createPage({ title: "Eingaben", content: pageDoc });
  const session = `page-${id}`;
  if ((await rt.languageStatuses()).find((r) => r.id === "python")?.where === MODE || (rt.setModeOf("python", MODE), (await rt.languageStatuses()).find((r) => r.id === "python")?.where === MODE)) {
    // Python: the input as a Table and as a variable of its name; a top-level return ends the cell with its output.
    const a = await runAsking(sessions, { session, language: "python", name: "Beträge", inputs: ["Ausgaben"], code: "betraege = [r['Betrag'] for r in Ausgaben.records()]\nif not betraege:\n    return None\nreturn {'sum': sum(betraege), 'n': len(inputs['Ausgaben'])}" }, { tables: "page", "write:outputs": "page" });
    assert.equal(a.r.status, "ok", JSON.stringify(sessions.readExecution(a.ex.id).outputs));
    const ret = a.r.returned as { sum: number; n: number };
    assert.ok(Math.abs(ret.sum - 1909.8) < 1e-9, String(ret.sum));
    assert.equal(ret.n, 4);
    assert.deepEqual(getOutput("Beträge")?.value, a.r.returned, "published for widgets under the cell's name");
    // The last expression is the output too — a table comes back as {cols, rows}.
    const b = await runAsking(sessions, { session, language: "python", code: "zeff.table('Pro Kategorie')" }, { tables: "page" });
    assert.deepEqual((b.r.returned as { cols: string[] }).cols, ["Kategorie", "Summe"]);
  } else t.diagnostic("no Python in this mode");

  if ((rt.setModeOf("node", MODE), (await rt.languageStatuses()).find((r) => r.id === "node")?.where === MODE)) {
    const c = await runAsking(sessions, { session, language: "node", inputs: ["Ausgaben"], code: "const rows = inputs.Ausgaben.records();\nreturn rows.filter((r) => r.Betrag > 50).map((r) => r.Kategorie);" }, { tables: "page" });
    assert.equal(c.r.status, "ok", JSON.stringify(sessions.readExecution(c.ex.id).outputs));
    assert.deepEqual(c.r.returned, ["Wohnen", "Essen", "Summe"]);
  }

  if ((rt.setModeOf("rust", MODE), (await rt.languageStatuses()).find((r) => r.id === "rust")?.where === MODE)) {
    // Rust: input("Name") is a small JSON value; the last expression (no ;) is the output.
    const d = await runAsking(sessions, { session, language: "rust", inputs: ["Ausgaben"], code: "let t = input(\"Ausgaben\");\nlet mut total = 0.0;\nfor r in t.rows() { let v = r.at(1).as_f64(); if v.is_finite() { total += v; } }\nvec![t.rows().len() as f64, total]" }, { tables: "page" });
    assert.equal(d.r.status, "ok", JSON.stringify(sessions.readExecution(d.ex.id).outputs));
    const [n, total] = d.r.returned as number[];
    assert.equal(n, 4);
    assert.ok(Math.abs(total - 1909.8) < 1e-9, String(total));
  }
});

test("a code cell reads an input it was not allowed to: the cell asks first; a refusal stops it before any code runs", { timeout: 60000 }, async (t) => {
  const { sessions, rt } = await api();
  rt.setNotebookEnabled(true);
  rt.setModeOf("python", MODE);
  if ((await rt.languageStatuses()).find((r) => r.id === "python")?.where !== MODE) return t.skip("no Python in this mode");
  const { createPage } = await import("@/plugins/workspace/store");
  const id = createPage({ title: "Streng", content: pageDoc });
  const r = await runAsking(sessions, { session: `page-${id}`, language: "python", inputs: ["Ausgaben"], code: "print('never')" }, {});
  assert.equal(r.r.status, "error");
  assert.doesNotMatch(JSON.stringify(sessions.readExecution(r.ex.id).outputs), /never/);
  assert.match(JSON.stringify(sessions.readExecution(r.ex.id).outputs), /Permission denied/);
});

test("writing into Zeff has permission sets of its own: rows added and changed, rows deleted, values published — each asked apart", { timeout: 120000 }, async (t) => {
  const { sessions, rt } = await api();
  rt.setNotebookEnabled(true);
  rt.setModeOf("python", MODE);
  if ((await rt.languageStatuses()).find((r) => r.id === "python")?.where !== MODE) return t.skip("no Python in this mode");
  const store = await import("@/plugins/workspace/store");
  const { newProperty, newView } = await import("@/plugins/workspace/model");
  const grants = await import("@/plugins/notebook/grants");
  const betrag = newProperty("Betrag", "number");
  const dbId = store.createPage({ kind: "database", title: "Kunden", schema: { titleName: "Name", properties: [betrag], views: [newView("Table")] } as never });
  const pageId = store.createPage({ title: "Schreiben", content: pageDoc });
  const session = `page-${pageId}`;

  // Added: asked as "write:database:<id>" — allowed for this page; the row is there; the code goes on.
  const a = await runAsking(sessions, { session, language: "python", code: "print(zeff.add_row('Kunden', {'Name': 'Anna', 'Betrag': 12}))" }, { [`write:database:${dbId}`]: "page" });
  assert.equal(a.r.status, "ok", JSON.stringify(sessions.readExecution(a.ex.id).outputs));
  const rows = store.rawRows(dbId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, "Anna");
  assert.equal(rows[0].cells[betrag.id], 12);
  assert.equal(grants.isGranted(pageId, `write:database:${dbId}`), true);
  assert.equal(grants.isGranted(pageId, `delete:database:${dbId}`), false, "writing does not allow deleting");
  assert.equal(grants.isGranted(pageId, `database:${dbId}`), false, "writing does not allow reading");

  // Changed: no new question.
  const u = await runAsking(sessions, { session, language: "python", code: `zeff.update_row('Kunden', ${rows[0].id}, {'Betrag': 20})` }, {});
  assert.equal(u.r.status, "ok", JSON.stringify(sessions.readExecution(u.ex.id).outputs));
  assert.equal(store.rawRows(dbId)[0].cells[betrag.id], 20);

  // A field that is not there says which are.
  const bad = await runAsking(sessions, { session, language: "python", code: "zeff.add_row('Kunden', {'Nope': 1})" }, {});
  assert.match(JSON.stringify(sessions.readExecution(bad.ex.id).outputs), /has no field .Nope. \(it has: Name, Betrag\)/);

  // Deleted: its own question; refused, the row stays.
  const d = await runAsking(sessions, { session, language: "python", code: `try:\n    zeff.delete_row('Kunden', ${rows[0].id})\nexcept PermissionError as e:\n    print('refused')` }, {});
  assert.match(text(sessions.readExecution(d.ex.id).outputs as Out[]), /refused/);
  assert.equal(store.rawRows(dbId).length, 1);
  const d2 = await runAsking(sessions, { session, language: "python", code: `zeff.delete_row('Kunden', ${rows[0].id})` }, { [`delete:database:${dbId}`]: "page" });
  assert.equal(d2.r.status, "ok");
  assert.equal(store.rawRows(dbId).length, 0, "moved to the trash");

  // Published: its own set again.
  const p = await runAsking(sessions, { session, language: "python", code: "zeff.publish('Gesamt', 42, 'EUR')" }, { "write:outputs": "page" });
  assert.equal(p.r.status, "ok", JSON.stringify(sessions.readExecution(p.ex.id).outputs));
  const { getOutput } = await import("@/plugins/workspace/widget-outputs");
  assert.equal(getOutput("Gesamt")?.value, 42);
});

test("sharedStorage: strings shared by the kernels of a page, across languages, kept after a restart", { timeout: 180000 }, async (t) => {
  const { sessions, rt } = await api();
  rt.setNotebookEnabled(true);
  rt.setModeOf("python", MODE);
  rt.setModeOf("node", MODE);
  rt.setModeOf("rust", MODE);
  const st = await rt.languageStatuses();
  const there = (id: string) => st.find((r) => r.id === id)?.where === MODE;
  if (!there("node") || !there("python")) return t.skip("needs Node.js and Python in this mode");
  const { createPage } = await import("@/plugins/workspace/store");
  const { readShared } = await import("@/plugins/notebook/shared-storage");
  const id = createPage({ title: "Geteilt", content: pageDoc });
  const session = `page-${id}`;
  // Node writes a serialized value; Python parses it, changes it and writes it back.
  const a = await runAsking(sessions, { session, language: "node", code: "const myVar = { a: 1, list: [1, 2, 3] };\nsharedStorage.set('myvar', JSON.stringify(myVar));\nsharedStorage.get('myvar')" }, {});
  assert.equal(a.r.status, "ok", JSON.stringify(sessions.readExecution(a.ex.id).outputs));
  assert.deepEqual(JSON.parse(readShared(session).myvar), { a: 1, list: [1, 2, 3] }, "kept for the page");
  const b = await runAsking(sessions, { session, language: "python", code: "import json\nv = json.loads(sharedStorage.get('myvar'))\nv['list'].append(4)\nsharedStorage.set('myvar', json.dumps(v))\nprint(sorted(sharedStorage.keys()), len(sharedStorage))\nsharedStorage.set('n', 5)" }, {});
  assert.equal(b.r.status, "error", "a value that is not a string is refused");
  assert.match(JSON.stringify(sessions.readExecution(b.ex.id).outputs), /holds strings/);
  const c = await runAsking(sessions, { session, language: "node", code: "JSON.parse(sharedStorage.get('myvar')).list.join(',') + '|' + sharedStorage.get('nope')" }, {});
  assert.equal(c.r.status, "ok");
  assert.match(JSON.stringify(sessions.readExecution(c.ex.id).outputs), /1,2,3,4\|null/, "Python's change is there for Node.js");
  // A restart of the session: the storage stays.
  sessions.restartSession(session, "node");
  const d = await runAsking(sessions, { session, language: "node", code: "sharedStorage.keys().join()" }, {});
  assert.match(JSON.stringify(sessions.readExecution(d.ex.id).outputs), /myvar/);
  // Removed and cleared.
  await runAsking(sessions, { session, language: "python", code: "sharedStorage.set('x', 'y')\ndel sharedStorage['x']\nsharedStorage.set('z', '1')" }, {});
  assert.deepEqual(Object.keys(readShared(session)).sort(), ["myvar", "z"]);
  if (there("rust")) {
    const e = await runAsking(sessions, { session, language: "rust", code: "let v = shared_get(\"z\").unwrap_or_default();\nshared_set(\"from_rust\", &format!(\"{}!\", v));\nshared_remove(\"myvar\");\nshared_keys().len()" }, {});
    assert.equal(e.r.status, "ok", JSON.stringify(sessions.readExecution(e.ex.id).outputs));
    assert.deepEqual(readShared(session), { z: "1", from_rust: "1!" });
  }
  await runAsking(sessions, { session, language: "node", code: "sharedStorage.clear()" }, {});
  assert.deepEqual(readShared(session), {});
});
