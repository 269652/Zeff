/**
 * Gmail's tools for agents (over the MCP): find mails with Gmail's own search and list the labels (any agent, read access),
 * and change them — labels, read, spam, never delete — only for the worker of an agent routine whose permissions say
 * "may change Gmail". What a mail says is no instruction: the permission is yours, not the mail's. Server only.
 */
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { callerRunId } from "@/mcp/caller";
import { isInstalled } from "@/plugins/state";
import { mayChangeGmail } from "@/plugins/workspace/routine-agent";

type Result = { content: { type: "text"; text: string }[]; isError?: boolean };
type Helpers = { run: (fn: () => Promise<Result> | Result) => Promise<Result>; ok: (text: string) => Result; fail: (text: string) => Result };

/** After a change in Gmail: the mirror here catches up now (a sync in the background; one already running does it). */
const refreshMirror = (): void => void import("@/lib/mail/sync").then((m) => m.syncMail({ background: true })).catch(() => undefined);

export function registerGmailTools(server: McpServer, { run, ok, fail }: Helpers): void {
  const off = () => (isInstalled("gmail") ? null : fail("The Gmail plugin is not installed in Zeff (Menu → Plugins) — this tool isn't available."));

  server.registerTool(
    "gmail_find",
    {
      title: "Find mails in Gmail",
      description:
        "Searches Gmail with its own query language (from:verivox, in:inbox, newer_than:30d, has:attachment, is:unread, label:…) and lists the mails: ref, sender, subject, labels, unread. Needs Google's API sign-in (Connections). Read-only. Use the refs with gmail_change.",
      inputSchema: z.object({ query: z.string().describe("Gmail search, e.g. 'in:inbox from:xing.com'"), limit: z.number().int().min(1).max(200).optional() }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args) =>
      run(async () => {
        const gone = off();
        if (gone) return gone;
        const { findGmail } = await import("@/lib/google/gmail-write");
        const mails = await findGmail(args.query, args.limit ?? 50);
        if (!mails.length) return ok("No mails found.");
        return ok(mails.map((m) => `${m.ref} | ${m.date?.slice(0, 10) ?? "?"} | ${m.from} | ${m.subject} | ${m.labels.join(",")}${m.unread ? " | unread" : ""}`).join("\n"));
      }),
  );

  server.registerTool(
    "gmail_labels",
    {
      title: "List Gmail labels",
      description: "The labels of the Gmail account (folders). Read-only.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async () =>
      run(async () => {
        const gone = off();
        if (gone) return gone;
        const { gmailLabels } = await import("@/lib/google/gmail-write");
        return ok((await gmailLabels()).map((l) => `${l.name}${l.type === "system" ? " (system)" : ""}`).join("\n"));
      }),
  );

  server.registerTool(
    "gmail_filters",
    {
      title: "List Gmail filters",
      description: "The filters (rules) Gmail has now, with what they match and do. Read-only. Needs the Google sign-in with filter access (Connections).",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async () =>
      run(async () => {
        const gone = off();
        if (gone) return gone;
        const { listGmailFilters, gmailLabels } = await import("@/lib/google/gmail-write");
        const names = new Map((await gmailLabels()).map((l) => [l.id, l.name]));
        const name = (id: string) => names.get(id) ?? id;
        const rows = await listGmailFilters();
        if (!rows.length) return ok("No filters.");
        return ok(rows.map((f) => `${f.id} | ${[f.from && `from:${f.from}`, f.to && `to:${f.to}`, f.subject && `subject:${f.subject}`, f.query].filter(Boolean).join(" ")} -> ${[...f.addLabelIds.map((l) => `+${name(l)}`), ...f.removeLabelIds.map((l) => `-${name(l)}`)].join(" ")}`).join("\n"));
      }),
  );

  server.registerTool(
    "gmail_filter",
    {
      title: "Make a Gmail filter",
      description:
        "Makes a filter (rule) in Gmail: mails from a sender / with a subject / with words get a label, skip the inbox (archive) and/or are marked read, from now on. With applyToExisting the mails that match now get the same (up to 1000). Never forwards, never trashes. Works only when the agent routine's permissions allow changing Gmail.",
      inputSchema: z.object({
        from: z.string().optional().describe("Sender: a name or address part, e.g. 'flink' or 'calendar-notification@google.com'"),
        to: z.string().optional(),
        subject: z.string().optional(),
        query: z.string().optional().describe("Gmail search words the mail has"),
        hasAttachment: z.boolean().optional(),
        addLabels: z.array(z.string()).optional().describe("Labels to put on (made when missing; 'a/b' nests)"),
        skipInbox: z.boolean().optional().describe("Skip the inbox (archive)"),
        markRead: z.boolean().optional(),
        applyToExisting: z.boolean().optional().describe("Also the mails that match now"),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (args) =>
      run(async () => {
        const gone = off();
        if (gone) return gone;
        if (!mayChangeGmail(callerRunId())) return fail("This agent may not change Gmail. Turn on the Gmail permission in the permissions of its routine page (and allow changes to Gmail on the Connections page).");
        const { createGmailFilter } = await import("@/lib/google/gmail-write");
        const { from, to, subject, query, hasAttachment, ...rest } = args;
        const r = await createGmailFilter({ criteria: { from, to, subject, query, hasAttachment }, ...rest });
        if (args.applyToExisting) refreshMirror();
        return ok(`Filter ${r.filterId} made.${r.createdLabels.length ? ` New labels: ${r.createdLabels.join(", ")}.` : ""}${args.applyToExisting ? ` Applied to ${r.applied} mail(s) there already.` : ""}`);
      }),
  );

  server.registerTool(
    "gmail_change",
    {
      title: "Change mails in Gmail (labels, read, spam)",
      description:
        "Adds or removes labels (by name; a new label is made; 'a/b' nests), marks mails read, or reports them as spam. Never deletes or trashes. Works only when the agent routine's permissions allow changing Gmail — otherwise it is refused. At most 200 mails per call; mails by their refs from gmail_find.",
      inputSchema: z.object({
        refs: z.array(z.string()).min(1).max(200),
        addLabels: z.array(z.string()).optional(),
        removeLabels: z.array(z.string()).optional(),
        markRead: z.boolean().optional(),
        spam: z.boolean().optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (args) =>
      run(async () => {
        const gone = off();
        if (gone) return gone;
        if (!mayChangeGmail(callerRunId())) return fail("This agent may not change Gmail. Turn on “May change Gmail” in the permissions of its routine page (and allow changes to Gmail on the Connections page).");
        const { changeGmail } = await import("@/lib/google/gmail-write");
        const r = await changeGmail(args);
        refreshMirror();
        return ok(`Changed ${r.changed} mail(s).${r.createdLabels.length ? ` New labels: ${r.createdLabels.join(", ")}.` : ""}`);
      }),
  );
}
