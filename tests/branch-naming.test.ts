import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

const ago = (days: number) => new Date(Date.now() - days * 864e5).toISOString();

async function seed() {
  const { getDb, schema } = await import("@/db");
  const msg = (key: string, text: string, days: number) =>
    getDb()
      .insert(schema.teamsMessages)
      .values({ key, kind: "chat", conversationId: "proj", messageId: key, sentAt: ago(days), html: "", text, link: "l", syncedAt: ago(0), senderName: "Christopher Lorenz", place: "PROJ Devs" } as never)
      .run();
  msg("proj|1", "origin/feature/PROJ-364-wichtig-schinkels-titel-bestellen-blau-p Bitte in Zukunft den Branch nicht so benennen.", 3);
  msg("proj|2", "Der Ticket-Titel ist nicht zwingend der Code Change. Lieber den Branch nach Code Change shorten lassen. So wissen wir direkt in der Commit History, was der eigentliche Change war.", 3);
  msg("proj|3", "Das Wetter ist schön, ich gehe an den Branch-Automaten.", 3); // says "branch" but isn't an instruction... still: no cue words
}

test("branch rules: a colleague's instruction kept as an artifact with its message linked — found by the settings page's suggestions, applied to the project, exported with its tags", async () => {
  await seed();
  const { suggestRuleMessages, addBranchRule, rulesFor, listBranchRules, setBranchRuleEnabled, branchRuleDocs, deleteBranchRule } = await import("@/lib/work/branch-rules");
  const found = suggestRuleMessages().map((s) => s.ref);
  assert.ok(found.includes("teams:proj|1") && found.includes("teams:proj|2"), "the instructions are suggested");
  assert.ok(!found.includes("teams:proj|3"), "talk about a branch that isn't an instruction isn't");

  const id = addBranchRule({ text: "Der Branch-Name beschreibt die Codeänderung, nicht den Ticket-Titel und nicht den Kundennamen — so sieht man in der Commit-History, was geändert wurde.", scope: "proj", refs: ["teams:proj|1", "teams:proj|2", "teams:gibt-es-nicht"] });
  assert.ok(id);
  assert.equal(addBranchRule({ text: "der branch-name beschreibt die codeänderung, nicht den ticket-titel und nicht den kundennamen — so sieht man in der commit-history, was geändert wurde." }), null, "the same sentence once");
  const [rule] = listBranchRules();
  assert.equal(rule.scope, "PROJ");
  assert.equal(rule.sources.length, 2, "the messages it comes from, kept as they are (a missing one isn't)");
  assert.match(rule.sources[1].text, /Code Change/);
  assert.deepEqual(rule.tags, ["branch-naming", "convention", "PROJ"]);
  assert.ok(!suggestRuleMessages().some((s) => s.ref === "teams:proj|1"), "cited messages aren't suggested again");

  assert.equal(rulesFor("PROJ-306").length, 1);
  assert.equal(rulesFor("ABC-1").length, 0, "another project's tickets don't get it");
  setBranchRuleEnabled(id!, false);
  assert.equal(rulesFor("PROJ-306").length, 0);
  setBranchRuleEnabled(id!, true);

  const [page] = branchRuleDocs("http://zeff");
  assert.equal(page.space, "Zeff · Branch-Kontext");
  assert.match(page.body, /^Tags: branch-naming, convention, PROJ/);
  assert.match(page.body, /Christopher Lorenz/);

  // The messages go from the sync; the rule keeps what they said.
  const { getSqlite } = await import("@/db");
  getSqlite().prepare("delete from teams_messages").run();
  assert.match(rulesFor("PROJ-306")[0].sources[0].text, /nicht so benennen/);
  deleteBranchRule(id!);
  assert.equal(listBranchRules().length, 0);
});

test("naming settings: the rule, its limits, your words and which context goes in — all from one place; the preview context says what is in and what is out", async () => {
  const { addBranchRule } = await import("@/lib/work/branch-rules");
  const { addManualTodo, getTodo } = await import("@/lib/boards/store");
  const { setStepPrefs } = await import("@/lib/boards/context-prefs");
  const { namingBlock, namingContext, namingLimits, proposeBranchName } = await import("@/lib/work/branch-naming");
  addBranchRule({ text: "Der Branch beschreibt die Codeänderung.", scope: "XYZ", refs: [] });
  const todo = addManualTodo({ ticket: "XYZ-5", text: "Das Navigationsmenü auf Mobilgeräten überarbeiten" });
  const t = getTodo(todo.id)!;

  // The defaults: 2–3 words, 24 characters, the rules and everything else in.
  assert.equal(namingLimits().de, "2–3 kleingeschriebene Wörter, höchstens 24 Zeichen");
  let block = namingBlock(t);
  assert.match(block, /Branch-Benennung \(Tag branch-naming, XYZ-5\)/);
  assert.match(block, /Regeln \(von Kollegen\)\n- Der Branch beschreibt die Codeänderung\./);
  assert.match(block, /nicht der Kundenname/);
  assert.match(proposeBranchName(t) ?? "", /^feature\/XYZ-5-[a-z-]{3,24}$/);
  assert.ok(namingContext(t).every((i) => i.included));

  // Changed under Auswerten → Branch names.
  setStepPrefs("branchname", { numbers: { maxChars: 12, words: 2 }, sources: { rules: false, todo: false }, extra: "Immer auf Englisch benennen." });
  block = namingBlock(t);
  assert.match(block, /2 kleingeschriebene Wörter, höchstens 12 Zeichen/);
  assert.match(block, /Immer auf Englisch benennen\./);
  assert.doesNotMatch(block, /Regeln \(von Kollegen\)/, "a source turned off is not in");
  assert.doesNotMatch(block, /### Das Todo/);
  const ctx = namingContext(t);
  assert.equal(ctx.find((i) => i.key === "rules")!.included, false);
  assert.ok(ctx.find((i) => i.key === "rules")!.lines.length > 0, "but the preview still has it, marked out");
  assert.ok((proposeBranchName(t) ?? "").replace("feature/XYZ-5-", "").length <= 12);
  assert.equal(namingLimits().en, "2 lowercase words, max 12 characters");
});
