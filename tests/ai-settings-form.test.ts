import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

/**
 * A <form action={…}> is reset by React after its action (form.reset()): a controlled radio then goes back to
 * its first `checked` state (React doesn't keep `defaultChecked` in step) while the state still says the new
 * one — the backend card flips back after saving, and the next save would send the old one. The form is
 * submitted by hand instead (no reset).
 */
test("the backend form isn't submitted through <form action>, which would reset its controlled radios", () => {
  const src = fs.readFileSync("src/components/AiSettingsForm.tsx", "utf8");
  assert.ok(!/<form[^>]*\baction=/.test(src), "a <form action={…}> resets the controlled radios after saving");
  assert.match(src, /<form[^>]*onSubmit=/);
});
