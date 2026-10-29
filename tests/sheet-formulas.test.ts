import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

// A table's cells as a spreadsheet: "=…" in a number or text cell is the cell's own formula — cells (A1, $A$1), ranges (A1:B3,
// B:B, 3:3), this row's column ([Betrag]), the tables shared for formulas (Kosten!B2, 'Meine Kosten'!A1, Kosten[Betrag]),
// Kennzahlen (@Sparrate, @[Frei im Monat]) and Excel's spelling (SUMME, MITTELWERT, WENN, ; = <> &).
setupTempData();

test("the language: cells, ranges, columns, rows, this row's column, other tables, Kennzahlen, Excel's names and operators", async () => {
  const { evalFormula, colLetters, colNumber } = await import("@/plugins/workspace/formula");
  const grid = [
    ["Miete", 800, "x"],
    ["Strom", 60.5, ""],
    ["Netz", "40", null],
  ];
  const names = ["Posten", "Betrag", "Notiz"];
  const sheet = (n: string | null) =>
    n === null || ["kosten", "meine kosten"].includes(n.toLowerCase()) ? { rows: 3, cols: 3, cell: (c: number, r: number) => grid[r]?.[c], colIndex: (x: string) => names.findIndex((y) => y.toLowerCase() === x.toLowerCase()), row: n === null ? 1 : undefined } : null;
  const ctx = { prop: () => null, sheet, metric: (n: string) => ({ sparrate: 100, "frei im monat": -79.6 })[n.toLowerCase()] ?? null };
  const v = (f: string) => {
    const r = evalFormula(f, ctx);
    return "error" in r ? `ERR ${r.error}` : r.value;
  };
  assert.equal(v("B1+B2"), 860.5);
  assert.equal(v("$B$1"), 800);
  assert.equal(v("SUMME(B1:B3)"), 900.5, "a number written as text counts");
  assert.equal(v("sum(B:B)"), 900.5);
  assert.equal(v("sum(2:2)"), 60.5, "texts in a range are left out");
  assert.equal(v("MITTELWERT(B1:B3)"), 900.5 / 3);
  assert.equal(v("[Betrag]*2"), 121, "this row's column");
  assert.equal(v("[@Betrag]"), 60.5);
  assert.equal(v("Kosten!B1"), 800);
  assert.deepEqual(v("'Meine Kosten'!B1:B2"), [800, 60.5]);
  assert.equal(v("SUMME(Kosten[Betrag])"), 900.5, "another table's column: all of it");
  assert.equal(v("@Sparrate*12"), 1200);
  assert.equal(v("@[Frei im Monat]+1"), -78.6);
  assert.equal(v('@"Frei im Monat"'), -79.6);
  assert.equal(v('WENN(B1>500; "teuer"; "ok")'), "teuer");
  assert.equal(v('A1&" "&B1'), "Miete 800");
  assert.equal(v("B1=800"), true);
  assert.equal(v("B1<>800"), false);
  assert.equal(v("ANZAHL(A1:C3)"), 3);
  assert.equal(v("ANZAHL2(A1:C3)"), 7);
  assert.equal(v("true ? B1 : B2"), 800, "a ternary with spaces is no range");
  assert.equal(v("WENNFEHLER(1/0; 0)"), 0);
  assert.equal(v("C9"), null, "a cell beyond the table is empty");
  assert.match(String(v("Nope!A1")), /No table "Nope" shared/);
  assert.match(String(v("A:3")), /A range is/);
  const bare = evalFormula("A1", { prop: () => null });
  assert.match("error" in bare ? bare.error : "", /work in a table's cells/);
  assert.deepEqual([colLetters(0), colLetters(25), colLetters(26), colNumber("AA"), colNumber("b")], ["A", "Z", "AA", 26, 1]);
});

test("in a table: =… in a cell is kept as its formula and worked out when read — the table as cells, shared tables by name, Kennzahlen; a plain value replaces it", async () => {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("workspace", true);
  const store = await import("@/plugins/workspace/store");
  const { newProperty, newView } = await import("@/plugins/workspace/model");
  const amount = newProperty("Betrag", "number");
  const note = newProperty("Notiz", "text");
  const costs = store.createPage({ kind: "database", title: "Kosten 2026", schema: { titleName: "Posten", properties: [amount, note], views: [newView("Alle", "table")] } });
  const miete = store.addRow(costs, { title: "Miete", cells: { [amount.id]: 800 } });
  const strom = store.addRow(costs, { title: "Strom", cells: { [amount.id]: 60 } });
  const sum = store.addRow(costs, { title: "Summe" });
  const cell = (db: number, rowId: number, propId: string) => store.rowsOf(db)!.rows.find((r) => r.id === rowId)!.cells;

  // The table's own cells: A = Posten, B = Betrag, C = Notiz.
  store.setCell(sum, amount.id, "=SUMME(B1:B2)");
  assert.equal(cell(costs, sum, amount.id)[amount.id], 860);
  assert.equal(cell(costs, sum, amount.id)[`${amount.id}=`], "=SUMME(B1:B2)", "the formula comes along (the editor shows it)");
  store.setCell(strom, note.id, '=A2&": "&[Betrag]');
  assert.equal(cell(costs, strom, note.id)[note.id], "Strom: 60");
  // A cell the formula reads changed: the value follows.
  store.setCell(strom, amount.id, 100);
  assert.equal(cell(costs, sum, amount.id)[amount.id], 900);
  // A circle is said, not hung.
  store.setCell(miete, amount.id, "=B3");
  assert.match(String(cell(costs, sum, amount.id)[`${amount.id}!`] ?? cell(costs, miete, amount.id)[`${amount.id}!`]), /Circular/);
  // A plain value again: the formula goes.
  store.setCell(miete, amount.id, 800);
  assert.equal(cell(costs, miete, amount.id)[`${amount.id}=`], undefined);
  assert.equal(cell(costs, sum, amount.id)[amount.id], 900);
  // A number column shows numbers: a text is said.
  store.setCell(miete, amount.id, '=WENN(B2>50; "teuer"; "ok")');
  assert.match(String(cell(costs, miete, amount.id)[`${amount.id}!`]), /not a number/);
  store.setCell(miete, amount.id, 800);
  // A formula that doesn't parse isn't saved.
  assert.throws(() => store.setCell(miete, amount.id, "=SUMME(B1:"), /The formula/);

  // Another table reads it once it is shared — under its name.
  const plan = store.createPage({ kind: "database", title: "Plan", schema: { titleName: "Was", properties: [newProperty("Wert", "number")], views: [newView("Alle", "table")] } });
  const wert = store.getDatabase(plan)!.schema.properties[0];
  const r = store.addRow(plan, { title: "Kosten im Jahr" });
  store.setCell(r, wert.id, "=SUMME('Kosten 2026'!B1:B2)*12");
  assert.match(String(cell(plan, r, wert.id)[`${wert.id}!`]), /No table "Kosten 2026" shared/, "not shared: not readable");
  store.setTableShare(costs, "Kosten 2026");
  assert.equal(cell(plan, r, wert.id)[wert.id], 10800);
  store.setCell(r, wert.id, "=SUMME('kosten 2026'[Betrag])");
  assert.equal(cell(plan, r, wert.id)[wert.id], 1800, "its whole column by name (Miete + Strom + the sum's 900)");
  assert.throws(() => store.setTableShare(plan, "Kosten 2026"), /shared already/);
  assert.deepEqual(store.sharedTables().map((x) => x.name), ["Kosten 2026"]);

  // Kennzahlen by @.
  const { workspaceMetrics } = await import("@/plugins/workspace/metric-point");
  workspaceMetrics.contribute("core", [{ label: "Frei im Monat", unit: "€", what: "Test", read: () => 250 }]);
  (await import("@/plugins/workspace/metrics")).forgetMetricValues();
  store.setCell(r, wert.id, "=@[Frei im Monat]*12 - 'Kosten 2026'!B1");
  assert.equal(cell(plan, r, wert.id)[wert.id], 2200);

  // A column's formula reads the table as cells too.
  const db = store.getDatabase(costs)!;
  const share = newProperty("Anteil", "formula");
  store.updateSchema(costs, { ...db.schema, properties: [...db.schema.properties, { ...share, formula: "round([Betrag] / B3 * 100)" }] });
  assert.equal(cell(costs, miete, share.id)[share.id], 89);

  // Unshared: the other table can't read it any more.
  store.setTableShare(costs, null);
  assert.match(String(cell(plan, r, wert.id)[`${wert.id}!`]), /No table "Kosten 2026" shared/);
});

test("a page's tables (/Tabelle): formula cells worked out in the browser — their own cells, the page's named tables, shared tables and Kennzahlen from the server, mentions; numbers written the German way", async () => {
  const { evaluatePageTables, cellNumberOrText, formatCellValue, metricKey } = await import("@/plugins/workspace/page-sheet");
  let pos = 0;
  const table = (name: string, rows: string[][], header = true) => ({ name, pos: (pos += 1000), rows: rows.map((r, ri) => r.map((text) => ({ text, pos: (pos += 10), size: 4, header: header && ri === 0 }))) });
  const kosten = table("Kosten", [
    ["Posten", "Betrag"],
    ["Miete", "800"],
    ["Strom", "60,50 €"],
    ["Summe", "=SUMME(B2:B3)"],
    ["Anteil", "=round(B2 / B4 * 100)"],
    ["Kreis", "=B6"],
  ]);
  const plan = table("", [
    ["Was", "Wert"],
    ["Im Jahr", "=Kosten!B4*12"],
    ["Frei", "=@[Frei im Monat] - SUMME(Kosten[Betrag])"],
    ["DB", "=SUMME(Verträge!B:B)"],
    ["Seite", '="Siehe " & [[page:12|Budget]]'],
    ["KZ", "=[[metric:frei-im-monat|Frei im Monat]] * 2"],
    ["Mitte", "=[Wert]"],
    ["Nix", "=Nope!A1"],
  ]);
  const data = { metrics: { [metricKey("Frei im Monat")]: 1000 }, sheets: { verträge: { cols: ["Name", "Pro Monat"], rows: [["Netflix", 13], ["Strom", 60]] } } };
  const r = evaluatePageTables([kosten, plan], data);
  const at = (t: typeof kosten, row: number, col = 1) => r.get(t.rows[row][col].pos);
  assert.equal(at(kosten, 3)?.value, 860.5);
  assert.equal(at(kosten, 4)?.value, 93);
  assert.match(String(at(kosten, 5)?.error), /Circular/);
  assert.equal(at(plan, 1)?.value, 10326);
  // The whole column of the named table — its circle (B6) makes the sum an error too, as a spreadsheet does (not a silent gap).
  assert.match(String(at(plan, 2)?.error), /B6: Circular/);
  assert.equal(at(plan, 3)?.value, 73, "a table shared for formulas, from the server");
  assert.equal(at(plan, 4)?.value, "Siehe Budget", "a mention is its name");
  assert.equal(at(plan, 5)?.value, 2000, "a Kennzahl's mention is its value");
  assert.match(String(at(plan, 6)?.error ?? at(plan, 6)?.value), /Circular|^$/);
  assert.match(String(at(plan, 7)?.error), /No table "Nope"/);
  assert.deepEqual([cellNumberOrText("1.200,50"), cellNumberOrText("-3,5"), cellNumberOrText("12 %"), cellNumberOrText(" "), cellNumberOrText("[[person:3|Max]] kommt")], [1200.5, -3.5, 12, null, "Max kommt"]);
  assert.equal(formatCellValue(true), "✓");
});

test("mentions as @ puts them in a cell: [[page:12|Titel]] in a formula, split for chips", async () => {
  const { evalFormula, refToken, splitRefs } = await import("@/plugins/workspace/formula");
  const v = evalFormula('concat([[todo:7|T-7 Rechnung]], " / ", [[metric:sparrate|Sparrate]] * 2)', { prop: () => null, metric: (n) => (n === "sparrate" ? 50 : null) });
  assert.deepEqual(v, { value: "T-7 Rechnung / 100" });
  assert.equal(refToken("page", "12", "Bud|get]"), "[[page:12|Budget]]");
  assert.deepEqual(splitRefs("Mit [[person:3|Max]] und [[page:12|Plan]]."), [{ text: "Mit " }, { kind: "person", ref: "3", label: "Max" }, { text: " und " }, { kind: "page", ref: "12", label: "Plan" }, { text: "." }]);
});
