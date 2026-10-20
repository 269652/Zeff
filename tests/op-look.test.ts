import assert from "node:assert/strict";
import test from "node:test";
import { opLook } from "@/lib/boards/op-look";

/** Every action has a look: an icon and a colour by what it does (talk, resolve, deliver, hand over, schedule, ticket) — an unknown one still gets one. */
test("opLook: icon and tone by what the action does", () => {
  assert.equal(opLook("gitlab-reply").tone, "indigo");
  assert.equal(opLook("teams-message").tone, "indigo");
  assert.equal(opLook("mail-compose").tone, "indigo");
  assert.equal(opLook("gitlab-resolve").tone, "emerald");
  assert.equal(opLook("gitlab-open-mr").tone, "emerald");
  assert.equal(opLook("gitlab-merge").tone, "emerald");
  assert.equal(opLook("git-push").tone, "emerald");
  assert.equal(opLook("work-instruct").tone, "violet");
  assert.equal(opLook("calendar-event").tone, "amber");
  assert.equal(opLook("jira-transition").tone, "sky");
  const unknown = opLook("something-new");
  assert.ok(unknown.icon && unknown.tone);
  assert.notEqual(opLook("gitlab-reply").icon, opLook("gitlab-resolve").icon, "different things look different");
});
