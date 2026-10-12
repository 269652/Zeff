import assert from "node:assert/strict";
import { test } from "node:test";
import { newBranchName } from "@/lib/work/agent";

test("a new branch starts with the Jira ticket key; the agent adds a few words for the code change", () => {
  assert.equal(newBranchName({ ticket: "PROJ-364", kind: "todo" } as never), "feature/PROJ-364-<short-change>");
  assert.equal(newBranchName({ ticket: "PROJ-364", kind: "fix" } as never), "fix/PROJ-364-<short-change>");
});
