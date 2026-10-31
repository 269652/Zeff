import { isInstalled } from "@/plugins/state";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { run, fail, ok } from "./kit";

/** Registers mr_comments, mr_reply, mr_resolve, mr_comment. */
export function registerMergeRequestTools(server: McpServer): void {
  // GitLab merge request comments: read what the reviewers wrote, answer in a thread (through Zeff's automation Chrome, as the user).
  server.registerTool(
    "mr_comments",
    {
      title: "Read merge request comments",
      description:
        "The review comments on a merge request as Zeff has synced them: who wrote what, in which thread, whether the thread is resolved, with the key (note:<id>) to answer it with mr_reply. " +
        "mr: the merge request's link, a comment's link (…#note_123), '!179', or words from its title. Read them before you change code a reviewer asked about — and answer each thread you dealt with.",
      inputSchema: z.object({
        mr: z.string().min(1).describe("A merge request or comment link, '!179', or words."),
        unresolvedOnly: z.boolean().optional().describe("Only comments in threads that aren't resolved (default: all)."),
        limit: z.number().int().min(1).max(100).optional(),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args) =>
      run(async () => {
        if (!isInstalled("gitlab")) return fail("GitLab is not installed in Zeff (Menu → Plugins) — this tool isn't available.");
        const { listGitlabItems } = await import("@/lib/gitlab/store");
        const { gitlabDone } = await import("@/lib/gitlab/shared");
        const items = listGitlabItems({ q: args.mr, kind: "comment", limit: 200 }).filter((i) => !args.unresolvedOnly || !gitlabDone(i));
        if (!items.length) return ok(`No synced comments for "${args.mr}" — the GitLab sync may not have read that merge request yet.`);
        const list = items.sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? "")).slice(-(args.limit ?? 40));
        return ok(
          list
            .map((i) => `[${i.key}] ${i.ref} ${i.title.slice(0, 80)} · ${i.author ?? "?"} · ${(i.createdAt ?? "").slice(0, 16)} · thread ${i.thread ?? "-"} · ${gitlabDone(i) ? "resolved" : "open"}\n${i.body.trim()}\n${i.url}`)
            .join("\n\n"),
        );
      }),
  );

  server.registerTool(
    "mr_reply",
    {
      title: "Answer a merge request comment",
      description:
        "Post a reply in the thread of a merge request comment (note:<id> from mr_comments, or its link) — it goes out in GitLab under the user's name, through Zeff's automation Chrome. " +
        "Reply once per thread, short and concrete: what you changed (and where — branch, commit) or the answer. Only for comments the todo or the user asks you to answer.",
      inputSchema: z.object({
        note: z.string().min(1).describe("note:<id> or the comment's link."),
        body: z.string().min(1).max(8000).describe("The reply, as Markdown."),
      }),
    },
    async (args) =>
      run(async () => {
        if (!isInstalled("gitlab")) return fail("GitLab is not installed in Zeff (Menu → Plugins) — this tool isn't available.");
        const { gitlabItemsByKeys } = await import("@/lib/gitlab/store");
        const { gitlabLinkKey } = await import("@/lib/gitlab/shared");
        const key = args.note.startsWith("note:") ? args.note : (gitlabLinkKey(args.note) ?? args.note);
        const item = gitlabItemsByKeys([key]).get(key);
        if (!item || item.kind !== "comment") return fail(`The comment ${args.note} isn't among the synced ones — use a key from mr_comments.`);
        const { postGitlabReply } = await import("@/lib/gitlab/reply");
        const r = await postGitlabReply(item.url, args.body);
        return ok(`Reply posted in ${item.ref} (${r.via === "api" ? "API" : "through the page"}): ${r.url}`);
      }),
  );

  server.registerTool(
    "mr_resolve",
    {
      title: "Resolve a merge request thread",
      description: "Resolve (or reopen) the thread of a merge request comment in GitLab. Resolve only what you dealt with and answered — the reviewer may want to see the answer first.",
      inputSchema: z.object({
        note: z.string().min(1).describe("note:<id> or the comment's link."),
        resolved: z.boolean().optional().describe("false reopens it (default: true)."),
      }),
    },
    async (args) =>
      run(async () => {
        if (!isInstalled("gitlab")) return fail("GitLab is not installed in Zeff (Menu → Plugins) — this tool isn't available.");
        const { gitlabItemsByKeys, setGitlabState } = await import("@/lib/gitlab/store");
        const { gitlabLinkKey } = await import("@/lib/gitlab/shared");
        const key = args.note.startsWith("note:") ? args.note : (gitlabLinkKey(args.note) ?? args.note);
        const item = gitlabItemsByKeys([key]).get(key);
        if (!item || item.kind !== "comment") return fail(`The comment ${args.note} isn't among the synced ones — use a key from mr_comments.`);
        const want = args.resolved !== false;
        const { resolveGitlabThread } = await import("@/lib/gitlab/reply");
        const r = await resolveGitlabThread(item.url, want);
        if (r.resolvable) setGitlabState(key, want ? "resolved" : "unresolved");
        return ok(r.resolvable ? `Thread in ${item.ref} ${want ? "resolved" : "reopened"}.` : `The comment in ${item.ref} isn't a thread GitLab resolves.`);
      }),
  );

  server.registerTool(
    "mr_comment",
    {
      title: "Comment on a merge request",
      description: "A new comment on a merge request (not in a thread) — in GitLab under the user's name, through Zeff's automation Chrome. For answers in a review thread use mr_reply.",
      inputSchema: z.object({
        project: z.string().min(1).describe("The project path, e.g. group/sub/project."),
        iid: z.number().int().min(1).describe("The merge request's number (179 for !179)."),
        body: z.string().min(1).max(8000),
      }),
    },
    async (args) =>
      run(async () => {
        if (!isInstalled("gitlab")) return fail("GitLab is not installed in Zeff (Menu → Plugins) — this tool isn't available.");
        const { commentOnMr } = await import("@/lib/gitlab/reply");
        const r = await commentOnMr(args.project, args.iid, args.body);
        return ok(`Comment posted: ${r.url}`);
      }),
  );
}
