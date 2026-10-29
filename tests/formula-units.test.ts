import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

// Units in formulas (units.ts): what a result is in, a number without one taking the other side's, what fits converted,
// what doesn't flagged — and what the plugins bring (Schulden(@Chris), Personen(@Freunde)), mentions as values.
setupTempData();

test("units: written as people write them, converted where they fit, made simple when multiplied", async () => {
  const u = await import("@/plugins/workspace/units");
  assert.equal(u.formatUnit(u.parseUnit("EUR pro Monat")), "€/Monat");
  assert.equal(u.formatUnit(u.parseUnit("Monate")), "Monat");
  assert.equal(u.formatUnit(u.parseUnit("km/h")), "km/h");
  assert.equal(u.conversion(u.parseUnit("€/Jahr"), u.parseUnit("€/Monat")), 1 / 12);
  assert.equal(u.conversion(u.parseUnit("h"), u.parseUnit("min")), 60);
  assert.equal(u.conversion(u.parseUnit("€"), u.parseUnit("h")), null);
  assert.equal(u.conversion(u.parseUnit("Monat"), u.parseUnit("Tag")), null, "a month isn't a number of days");
  const s = u.simplify(u.combine(u.parseUnit("€/Monat"), u.parseUnit("Jahre"), 1));
  assert.deepEqual([u.formatUnit(s.unit), s.factor], ["€", 12]);
  assert.deepEqual(u.numberWithUnit("1.200,50 €/Monat"), { n: 1200.5, unit: { "€": 1, Monat: -1 }, label: "€/Monat" });
  assert.equal(u.numberWithUnit("Miete"), null);
});

test("a formula with units: a bare number takes the Kennzahl's, €/Jahr goes into €/Monat, a share of an amount, what doesn't fit is said", async () => {
  const { evalWithUnits } = await import("@/plugins/workspace/formula");
  const metrics: Record<string, [number, string]> = { tilgungsrate: [1608, "€/Monat"], sparquote: [45, "%"], nettoeinkommen: [3552, "€/Monat"], "schuldenfrei in": [127, "Monate"], stunden: [9.5, "h"] };
  const grid: [unknown, string | null][][] = [
    [[1200, "€/Jahr"], [30, "min"]],
    [[3, null], [2, "h"]],
  ];
  const sheet = () => ({ rows: 2, cols: 2, cell: (c: number, r: number) => grid[r]?.[c]?.[0] ?? null, unit: (c: number, r: number) => grid[r]?.[c]?.[1] ?? null, colIndex: () => -1, row: 1 });
  const ctx = { prop: () => null, sheet, metric: (n: string) => metrics[n.toLowerCase()]?.[0], metricUnit: (n: string) => metrics[n.toLowerCase()]?.[1] ?? null };
  const v = (f: string) => {
    const r = evalWithUnits(f, ctx);
    return "error" in r ? `ERR ${r.error}` : `${Math.round(Number(r.value) * 100) / 100} ${r.unit}${r.warnings.length ? ` ⚠ ${r.warnings.join("; ")}` : ""}`.trim();
  };
  assert.equal(v("@Tilgungsrate + 3"), "1611 €/Monat");
  assert.equal(v("A2 + @Tilgungsrate"), "1611 €/Monat");
  assert.equal(v("@Tilgungsrate + A1"), "1708 €/Monat", "1.200 €/Jahr is 100 €/Monat");
  assert.equal(v("@Tilgungsrate * @[Schuldenfrei in]"), "204216 €");
  assert.equal(v("@Sparquote * @Nettoeinkommen"), "1598.4 €/Monat", "45 % of the income");
  assert.match(v("@Tilgungsrate + @Stunden"), /€\/Monat ⚠ €\/Monat and h don't go together/);
  assert.equal(v("SUMME(B1:B2)"), "150 min", "a range in min and h: one unit");
  assert.equal(v("WENN(A2>1; @Tilgungsrate; 0)"), "1608 €/Monat");
  assert.equal(v("round(@Tilgungsrate / @Nettoeinkommen * 100)"), "45", "€/Monat over €/Monat: a plain number");
  assert.equal(v("@Tilgungsrate * 12 Monate"), "19296 €", "a unit written in the formula");
  assert.equal(v("2 h + 30 min"), "2.5 h");
  assert.equal(v("3 €/Monat * 1 Jahr"), "36 €");
  assert.equal(v("min(5; 3) + 10 % 3"), "4", "min( is a function, % is modulo");
  assert.equal(v("@Nettoeinkommen * 45 %"), "1598.4 €/Monat", "a % at the end is percent: a share of the amount");
  assert.equal(v("45 %"), "45 %");
  assert.equal(v("WENN(A2 > 1; 5 %; 0) + 1"), "6 %");
  assert.equal(v("(10 %) * 2"), "20 %");
});

test("a page's table: a cell that is a Kennzahl is its value in its unit; 12 € and 5 h are numbers with theirs; a plugin's function is asked of the server", async () => {
  const { evaluatePageTables, formatCellValue } = await import("@/plugins/workspace/page-sheet");
  let pos = 0;
  const table = (rows: string[][]) => ({ name: "", pos: (pos += 1000), rows: rows.map((r) => r.map((text) => ({ text, pos: (pos += 10), size: 4, header: false }))) });
  const t = table([["[[metric:tilgungsrate|Tilgungsrate]]", "12 €"], ["=A1+3", "=B1*2"], ["=SUMME(Schulden(@Freunde))", "=A1+5 h"]]);
  const data = { metrics: { tilgungsrate: 1608 }, metricUnits: { tilgungsrate: "€/Monat" }, sheets: {}, functions: [{ name: "Schulden", aliases: [], unit: "€" }], calls: {} as Record<string, { value: unknown } | { error: string }> };
  const pending: { name: string; args: unknown[] }[] = [];
  let r = evaluatePageTables([t], data as never, pending as never);
  const at = (row: number, col: number) => r.get(t.rows[row][col].pos)!;
  assert.deepEqual([at(1, 0).value, at(1, 0).unit], [1611, "€/Monat"]);
  assert.equal(formatCellValue(at(1, 1).value, "de-DE", at(1, 1).unit), "24 €");
  assert.match(String(at(2, 1).warnings), /€\/Monat and h/);
  assert.equal(at(2, 0).error, "…", "asked of the server");
  assert.deepEqual(pending, [{ name: "Schulden", args: [{ e: ["name", "Freunde", "Freunde"] }] }]);
  data.calls[`schulden(${JSON.stringify(pending[0].args)})`] = { value: [300, 1400] };
  r = evaluatePageTables([t], data as never, []);
  assert.deepEqual([at(2, 0).value, at(2, 0).unit], [1700, "€"]);
});

test("the plugins' functions in a table's cells: Schulden(@Chris) and SUMME(Schulden(@Freunde)) through People's circles; a cell's result goes into its column's unit or is flagged", async () => {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("workspace", true);
  setInstalled("people", true);
  const people = await import("@/plugins/people/store");
  const chris = people.createPerson({ name: "Chris Becker" });
  const lena = people.createPerson({ name: "Lena Wolf" });
  people.setCircle(chris, "friends", "manual");
  people.setCircle(lena, "friends", "manual");
  // A plugin's function (as Finances brings Schulden): what is owed to each.
  const { workspaceFormulaFunctions } = await import("@/plugins/workspace/formula-point");
  const { needPeople } = await import("@/plugins/people/formulas");
  const owed: Record<number, number> = { [chris]: 300, [lena]: 1400 };
  workspaceFormulaFunctions.contribute("core", [{ name: "Testschulden", unit: "€", signature: "Testschulden(@Person)", what: "test", call: (args) => {
    const who = needPeople(args[0], "Testschulden");
    return who.group ? who.people.map((p) => owed[p.id] ?? 0) : (owed[who.people[0].id] ?? 0);
  } }]);
  await import("@/plugins/workspace/metrics");
  const store = await import("@/plugins/workspace/store");
  const { newProperty, newView } = await import("@/plugins/workspace/model");
  const plain = newProperty("Wert", "number");
  const euro = { ...newProperty("Euro", "number"), format: "euro" as const };
  const hours = { ...newProperty("Stunden", "number"), format: "hours" as const };
  const note = newProperty("Notiz", "text");
  const db = store.createPage({ kind: "database", title: "Units", schema: { titleName: "Was", properties: [plain, euro, hours, note], views: [newView("Alle", "table")] } });
  const row = store.addRow(db, { title: "Eins" });
  const cells = () => store.rowsOf(db)!.rows.find((r) => r.id === row)!.cells;
  store.setCell(row, plain.id, "=Testschulden(@Chris)");
  assert.deepEqual([cells()[plain.id], cells()[`${plain.id}~`]], [300, "€"], "a column without a unit shows the result's");
  store.setCell(row, plain.id, "=SUMME(Testschulden(@Freunde))");
  assert.equal(cells()[plain.id], 1700, "a circle: one value per person, summed");
  store.setCell(row, plain.id, "=SUMME(Testschulden([[person:" + lena + "|Lena Wolf]]))");
  assert.equal(cells()[plain.id], 1400, "a person picked from the @ menu");
  store.setCell(row, plain.id, "=ANZAHL2(Personen(@Freunde))");
  assert.equal(cells()[plain.id], 2);
  store.setCell(row, note.id, '=Kreis(@Chris) & ": " & Testschulden(@Chris)');
  assert.equal(cells()[note.id], "Friends: 300");
  store.setCell(row, euro.id, "=Testschulden(@Lena)");
  assert.equal(cells()[euro.id], 1400, "€ into a € column");
  store.setCell(row, hours.id, "=Testschulden(@Lena)");
  assert.match(String(cells()[`${hours.id}?`]), /The column is in h — the formula gives €/);
  assert.match(String((store.setCell(row, plain.id, "=Testschulden(@Niemand)"), cells())[`${plain.id}!`]), /No person or circle "Niemand"/);
  assert.match(String((store.setCell(row, plain.id, "=@Chris + 1"), cells())[`${plain.id}!`]), /no Kennzahl and no number/);
});

test("circles in the @ menu: offered by their name and the words they go by (Freunde, Banken), picked one is the whole circle in a formula, kept in a page", async () => {
  const { circlesFor, peopleOf } = await import("@/plugins/people/formulas");
  assert.deepEqual(circlesFor("freu").map((c) => c.key), ["friends"]);
  assert.deepEqual(circlesFor("bank").map((c) => c.key), ["authorities"], "a bank is a creditor");
  const friends = circlesFor("friends")[0];
  assert.ok(friends.count >= 2, "the two friends of the test before");
  const { EntityRef, evalFormula } = await import("@/plugins/workspace/formula");
  assert.equal(peopleOf(new EntityRef("circle", "friends", "Freunde"))?.people.length, friends.count);
  const r = evalFormula("ANZAHL2(Personen([[circle:friends|Freunde]]))", { prop: () => null });
  assert.deepEqual(r, { value: friends.count });
  const { docToMarkdown, markdownToDoc } = await import("@/plugins/workspace/doc");
  const doc = markdownToDoc("Schulden bei [[circle:friends|Freunde]]");
  assert.match(JSON.stringify(doc), /"kind":"circle","ref":"friends"/);
  assert.match(docToMarkdown(doc), /\[\[circle:friends\|Freunde\]\]/);
});
