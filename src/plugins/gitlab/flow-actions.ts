import type { FlowAction } from "@/plugins/workspace/flows/actions";

/**
 * What flows can do in GitLab — through Zeff's GitLab connection (GitLab settings): answer a comment, mark its thread resolved, merge a
 * merge request, sync. What an app built in the Workspace (GitLab's own view, one the AI makes) does with a button. Changing GitLab is
 * sending out: a flow needs "send", and a dry run only says what it would do.
 */

const noteOf = (v: unknown) => {
  const m = /(\d+)\s*$/.exec(String(v ?? ""));
  if (!m) throw new Error(`“${String(v ?? "")}” is not a GitLab comment (note:123 or its number).`);
  return `note:${m[1]}`;
};

type Ctx = Parameters<FlowAction["run"]>[1];
/** What GitLab's run said it did (it throws when it couldn't). */
const done = (r: { what: string }) => ({ done: r.what });
/** Changing GitLab: allowed to send? A dry run: what it would do. */
const guard = (ctx: Ctx, would: unknown) => {
  ctx.may("send");
  return ctx.dryRun ? { dryRun: true, would } : null;
};

export const GITLAB_FLOW_ACTIONS: FlowAction[] = [
  {
    name: "gitlab.reply",
    group: "gitlab",
    label: "Answer a GitLab comment",
    summary: "Writes an answer in a comment's thread in GitLab. Changes GitLab: the flow needs “send”.",
    input: [
      { name: "note", type: "text", required: true, help: "The comment: note:123 (an item's key) or its number" },
      { name: "body", type: "text", required: true, help: "The answer (Markdown)" },
    ],
    output: "{ done }",
    needs: ["send"],
    writes: true,
    run: async (i, ctx) => {
      const op = { type: "gitlab-reply" as const, note: noteOf(i.note), body: String(i.body ?? "").trim().slice(0, 8000) };
      if (!op.body) throw new Error("The answer is empty.");
      return guard(ctx, op) ?? done(await (await import("./run")).runGitlabNote(op));
    },
  },
  {
    name: "gitlab.resolve",
    group: "gitlab",
    label: "Resolve a GitLab thread",
    summary: "Marks a comment's thread resolved in GitLab. Changes GitLab: the flow needs “send”.",
    input: [{ name: "note", type: "text", required: true, help: "The comment: note:123 or its number" }],
    output: "{ done }",
    needs: ["send"],
    writes: true,
    run: async (i, ctx) => {
      const op = { type: "gitlab-resolve" as const, note: noteOf(i.note) };
      return guard(ctx, op) ?? done(await (await import("./run")).runGitlabNote(op));
    },
  },
  {
    name: "gitlab.merge",
    group: "gitlab",
    label: "Merge a merge request",
    summary: "Merges a merge request in GitLab (its project path, its number). Changes GitLab: the flow needs “send”.",
    input: [
      { name: "project", type: "text", required: true, help: "The project's path, e.g. group/app" },
      { name: "iid", type: "number", required: true, help: "The merge request's number (!167 → 167)" },
      { name: "source", type: "text", help: "Its branch (when known)" },
    ],
    output: "{ done }",
    needs: ["send"],
    writes: true,
    run: async (i, ctx) => {
      const iid = Number(String(i.iid ?? "").replace(/^!/, ""));
      if (!(iid > 0)) throw new Error("The merge request's number is missing.");
      const op = { type: "gitlab-merge" as const, project: String(i.project ?? "").trim(), iid, source: String(i.source ?? "") };
      return guard(ctx, op) ?? done(await (await import("./run")).runGitlabMerge(op));
    },
  },
  {
    name: "gitlab.sync",
    group: "gitlab",
    label: "Sync GitLab",
    summary: "Reads the merge requests, comments and branches from GitLab now — what GitLab's app shows.",
    input: [],
    output: "{ done }",
    writes: true,
    run: async (_i, ctx) => {
      if (ctx.dryRun) return { dryRun: true, would: "sync" };
      const r = await (await import("@/lib/sync/registry")).syncAndWait("gitlab");
      if (!r.lastOk) throw new Error(r.lastMessage ?? "The sync failed.");
      return { done: r.lastMessage ?? "" };
    },
  },
];
