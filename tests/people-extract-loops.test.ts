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
  assert.ok(on.startsWith(INSTRUCTIONS), "on: the prompt as before …");
  assert.match(on, /Frage an mich/, "… and the questions and requests as commitments");
  setInstalled("loops", false);
});
