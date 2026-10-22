import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * The People extraction reads questions to me, review/sign requests and my own unanswered questions as commitments only while the
 * Open loops plugin is on (off by default): its prompt stays as it was for everyone else until that change has had its
 * before/after eval (`npm run eval -- people`).
 */
test("people extraction: the open-loops addendum only while the Open loops plugin is on", async () => {
  const { setInstalled } = await import("@/plugins/state");
  const { extractInstructions, INSTRUCTIONS } = await import("@/plugins/people/extract");
  setInstalled("people", true);
  setInstalled("loops", false);
  assert.equal(extractInstructions(), INSTRUCTIONS, "off: the prompt as before");
  assert.ok(!INSTRUCTIONS.includes("Frage an mich"), "the built-in prompt itself is unchanged");
  setInstalled("loops", true);
  const on = extractInstructions();
  assert.match(on, /Frage an mich/, "on: the questions and requests as commitments");
  setInstalled("loops", false);
});

/**
 * Appended at the end, the addendum pulled the AI's attention to commitments and it found less of the rest (the eval of
 * 2026-10-22 lost a confirmed case number). So it goes right under the commitment kind, says that everything else is read as
 * fully as before — and only a prompt without that line (your own, System → Prompts) gets it at the end.
 */
test("people extraction: the addendum sits under the commitment kind, the rest of the prompt untouched around it", async () => {
  const { setInstalled } = await import("@/plugins/state");
  const { extractInstructions, INSTRUCTIONS } = await import("@/plugins/people/extract");
  setInstalled("people", true);
  setInstalled("loops", true);
  const on = extractInstructions();
  const lines = INSTRUCTIONS.split("\n");
  const at = lines.findIndex((l) => l.startsWith("- commitment:"));
  assert.ok(at > 0);
  const onLines = on.split("\n");
  assert.deepEqual(onLines.slice(0, at + 1), lines.slice(0, at + 1), "everything up to the commitment kind as it was");
  assert.match(onLines[at + 1], /^ {2}.*Frage an mich/, "the addendum right under it, indented");
  assert.match(onLines[at + 1], /genauso vollständig/, "… saying the rest is read as fully as before");
  assert.deepEqual(onLines.slice(at + 2), lines.slice(at + 1), "everything after it as it was");
  setInstalled("loops", false);
});

test("people extraction: a prompt of your own without the commitment line gets the addendum at the end", async () => {
  const { withLoopsAddendum, LOOPS_ADDENDUM } = await import("@/plugins/people/extract");
  assert.equal(withLoopsAddendum("Meine eigenen Anweisungen."), `Meine eigenen Anweisungen.\n\n${LOOPS_ADDENDUM}`);
});
