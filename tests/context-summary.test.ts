import assert from "node:assert/strict";
import test from "node:test";
import type { TodoSource, TodoUserNote } from "../src/lib/todos/shared";
import { groupOfKind, summarizeContext } from "../src/lib/context-summary";

const mail = (folder: string, key: string) => ({ source: "mail", mail: { key, folder } }) as unknown as TodoSource;
const gitlab = (kind: string, state?: string) => ({ source: "gitlab", gitlab: { kind, state } }) as unknown as TodoSource;
const note = (at: string, by?: string) => ({ at, text: "x", by }) as unknown as TodoUserNote;

/** A table row carries only how much there is of each kind (the toggle fetches the context itself): counted like the toggle counts. */
test("summarizeContext: counts by kind — chats apart from mail, GitLab's kinds together, notes and reports", () => {
  const s = summarizeContext(
    [mail("Posteingang", "a"), mail("WhatsApp", "b"), mail("Signal", "c"), mail("WhatsApp", "d"), gitlab("note"), gitlab("mr"), gitlab("branch", "pushed")],
    [note("2026-10-01"), note("2026-10-02", "Zeff"), note("2026-10-03", "W-12")],
  );
  assert.deepEqual(s.groups, { mail: 1, whatsapp: 2, signal: 1, gitlab: 3, note: 1, report: 2 });
  assert.equal(s.n, 10);
  assert.equal(s.remote, true, "a pushed branch is on the remote");
  assert.equal(summarizeContext([gitlab("branch", "not pushed")], []).remote, false);
  assert.deepEqual(summarizeContext([], []), { n: 0, groups: {}, remote: false });
  assert.equal(groupOfKind("jira-comment"), "jira");
});
