import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

test("agents over MCP read a merge request's review comments and can't answer one that isn't synced", async () => {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("gitlab", true);
  const { saveGitlabItems } = await import("@/lib/gitlab/store");
  const base = { projectUrl: "https://git.example.com/g/p", project: "g/p", ref: "!179", title: "PROJ-478 source db", branch: null, parent: "mr:g/p!179", inContext: false, resolvedAt: null, updatedAt: "2026-10-13T09:20:00Z" };
  saveGitlabItems([
    { ...base, key: "note:1", kind: "comment", body: "Brauchen wir den File Check überhaupt?", author: "Christopher Lorenz", state: "unresolved", createdAt: "2026-10-13T09:13:00Z", url: "https://git.example.com/g/p/-/merge_requests/179#note_1", thread: "d1" },
    { ...base, key: "note:2", kind: "comment", body: "Erledigt, danke.", author: "Christopher Lorenz", state: "resolved", createdAt: "2026-10-13T09:14:00Z", url: "https://git.example.com/g/p/-/merge_requests/179#note_2", thread: "d2" },
  ]);
  const { registerZeffTools } = await import("@/mcp/server");
  const tools: Record<string, (a: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>> = {};
  registerZeffTools({ registerTool: (name: string, _c: unknown, fn: never) => void (tools[name] = fn) } as never);
  for (const n of ["gitlab_mr_comments", "gitlab_reply", "gitlab_resolve", "gitlab_comment"]) assert.ok(tools[n], n);
  const all = await tools.gitlab_mr_comments({ mr: "!179" });
  assert.match(all.content[0].text, /\[note:1\][\s\S]*File Check[\s\S]*\[note:2\]/);
  const open = await tools.gitlab_mr_comments({ mr: "!179", unresolvedOnly: true });
  assert.match(open.content[0].text, /note:1/);
  assert.doesNotMatch(open.content[0].text, /note:2/);
  const bad = await tools.gitlab_reply({ note: "note:999", body: "x" });
  assert.match(bad.content[0].text, /isn't among the synced/);
});
