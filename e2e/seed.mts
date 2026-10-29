/**
 * What the e2e smoke tests need in a test server's database, made with the app's own functions (run by
 * scripts/test-server.mjs --seed e2e/seed.mts, or by e2e/run.mjs against a running test server): a person, and a database
 * with a number and a checkbox column and two rows. What was made goes to e2e-seed.json beside the database.
 */
import fs from "node:fs";
import path from "node:path";

const dbPath = process.env.DATABASE_PATH;
if (!dbPath || !process.env.ZEFF_TEST_SERVER) throw new Error("Only for a test server's database (DATABASE_PATH + ZEFF_TEST_SERVER).");
const out = path.join(path.dirname(dbPath), "e2e-seed.json");

if (!fs.existsSync(out)) {
  const { createPerson } = await import("@/plugins/people/store");
  const { createPage, addRow } = await import("@/plugins/workspace/store");
  const { newProperty, newView } = await import("@/plugins/workspace/model");

  const personName = "Erika Mustermann";
  const personId = createPerson({ name: personName });
  const dose = newProperty("Dosis", "number");
  const taken = newProperty("Genommen", "checkbox");
  const dbTitle = "E2E Medikamente";
  const dbId = createPage({ kind: "database", title: dbTitle, schema: { titleName: "Name", properties: [dose, taken], views: [newView("Table", "table")] } });
  const rows = [addRow(dbId, { title: "Alpha", cells: { [dose.id]: 10 } }), addRow(dbId, { title: "Beta", cells: { [dose.id]: 20 } })];
  fs.writeFileSync(out, JSON.stringify({ personId, personName, dbId, dbTitle, rows, rowTitles: ["Alpha", "Beta"], props: { dose: dose.id, taken: taken.id } }, null, 2));
}
console.log(`e2e seed: ${out}`);
