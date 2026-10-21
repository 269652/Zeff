import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

process.env.KNOWLEDGE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "zeff-k-"));

test("profile facts: what a compiled page says about you (your net income in a month …) is kept with its page — replaced when the page is compiled again, the latest page's figure for a month", async () => {
  const { db } = await import("../knowledge/lib/db");
  const d = db();
  const now = "2026-10-20T00:00:00.000Z";
  d.prepare("insert into pages (id, space, title, url, body, fetched_at, version) values ('b9', 'Zeff · Konto', 'Kontoauszug Revolut September 2026', '', 'x', ?, 1), ('b8', 'Zeff · Konto', 'Kontoauszug Revolut August 2026', '', 'y', ?, 1), ('pay9', 'Zeff · Documents', 'Gehaltsabrechnung 09', '', 'z', ?, 1)").run(now, now, now);
  const { savePage } = await import("../knowledge/lib/compile");
  const { profileFacts } = await import("../knowledge/lib/profile");
  const page = (id: string) => d.prepare("select id, title, space, body, version from pages where id = ?").get(id) as { id: string; title: string; space: string; body: string; version: number };
  const empty = { summary: "s", concepts: [], entities: [], relations: [] };
  savePage(page("b9"), { id: "b9", ...empty, profile: [{ key: "net_income", period: "2026-09", amount: 3552, text: "Gehalt vom Arbeitgeber" }, { key: "net_income", period: "bad", amount: 1, text: "" }, { key: "unknown", period: "2026-09", amount: 5, text: "" }] });
  savePage(page("b8"), { id: "b8", ...empty, profile: [{ key: "net_income", period: "2026-08", amount: 3552, text: "Gehalt" }] });
  let facts = profileFacts("net_income");
  assert.deepEqual(facts.map((f) => [f.period, f.amount]), [["2026-09", 3552], ["2026-08", 3552]], "the newest month first; a wrong period or key isn't kept");
  assert.equal(facts[0].pageTitle, "Kontoauszug Revolut September 2026");
  // Compiled again with another figure: replaced.
  savePage(page("b9"), { id: "b9", ...empty, profile: [{ key: "net_income", period: "2026-09", amount: 3600, text: "Gehalt" }] });
  assert.equal(profileFacts("net_income")[0].amount, 3600);
  // Another page for the same month (a payslip, compiled later): its figure counts for the month — one per month.
  savePage(page("pay9"), { id: "pay9", ...empty, profile: [{ key: "net_income", period: "2026-09", amount: 3610.5, text: "Nettolohn laut Abrechnung" }] });
  facts = profileFacts("net_income");
  assert.equal(facts.filter((f) => f.period === "2026-09").length, 1);
  assert.equal(facts[0].amount, 3610.5);
  // A page gone: its facts go.
  d.prepare("delete from pages where id = 'pay9'").run();
  assert.equal(profileFacts("net_income")[0].amount, 3600);
});
