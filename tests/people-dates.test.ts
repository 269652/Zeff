import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { ROOT, setupTempData } from "./helpers";

// A person's dates found after the briefing, with a fake Claude CLI answering as the AI would: no Claude, no cost.
setupTempData();
process.env.CLAUDE_CLI = path.join(ROOT, "tests", "fake-claude-json.mjs");
process.env.KNOWLEDGE_URL = "http://192.0.2.1:1";

async function setup() {
  const { setInstalled } = await import("@/plugins/state");
  for (const p of ["people", "llm", "claude-cli"]) setInstalled(p, true);
  const { updateAppSettings } = await import("@/lib/ai");
  updateAppSettings({ aiProvider: "claude" });
}

test("a birthday found for someone who has none goes in as theirs (the birthday field) — a second one, or another date, stays a proposal", async () => {
  await setup();
  const { createPerson, datesOf } = await import("@/plugins/people/store");
  const karla = createPerson({ name: "Karla" });
  process.env.FAKE_CLAUDE_OUTPUT = JSON.stringify({ dates: [{ kind: "birthday", day: 13, month: 2, year: null, yearly: true, quote: "Geburtstag am 13.02." }, { kind: "other", label: "Umzug", day: 1, month: 12, year: 2026, yearly: false, quote: "zieht am 1.12. um" }] });
  const { getSqlite } = await import("@/db");
  // A message naming her, so there is something to read.
  getSqlite().prepare("insert into emails (key, folder, from_name, subject, preview, received_at, conv_id, synced_at) values ('wa:1', 'WhatsApp', 'Karla', '', 'Karla hat am 13.02. Geburtstag', ?, 'wa:karla', ?)").run(new Date().toISOString(), new Date().toISOString());
  const { datesAfterBriefing } = await import("@/plugins/people/dates");
  await datesAfterBriefing();
  const dates = datesOf(karla);
  const bday = dates.find((d) => d.kind === "birthday")!;
  assert.ok(bday, "her birthday");
  assert.deepEqual([bday.day, bday.month, bday.confirmed], [13, 2, true], "entered, not only proposed");
  assert.equal(dates.find((d) => d.kind === "other")!.confirmed, false, "another date: a proposal");
  // Looked at again only after two weeks; with a birthday, not again.
  process.env.FAKE_CLAUDE_OUTPUT = JSON.stringify({ dates: [{ kind: "birthday", day: 14, month: 2, year: null, yearly: true, quote: "?" }] });
  await datesAfterBriefing(new Date(Date.now() + 30 * 864e5));
  assert.equal(datesOf(karla).filter((d) => d.kind === "birthday").length, 1, "she has her birthday: not asked again");
});
