import type { FlowAction } from "@/plugins/workspace/flows/actions";

/**
 * What flows can do in Jira — through Zeff's Jira connection (the Jira MCP server, Jira settings): comment on a ticket, move it, give it to
 * someone, sync the tickets. What an app built in the Workspace (Jira's own view, one the AI makes) does with a button. Changing Jira is
 * sending out: a flow needs the permission "send" for it, and a dry run only says what it would do.
 */

const TICKET = /^[A-Z][A-Z0-9]+-\d+$/;
const ticketOf = (v: unknown) => {
  const key = String(v ?? "").trim().toUpperCase();
  if (!TICKET.test(key)) throw new Error(`“${String(v ?? "")}” is not a Jira ticket key (like PROJ-123).`);
  return key;
};

type Op = Parameters<typeof import("./run").runJiraOps>[0][number];

/** One operation on Jira, as the todos' actions do it (run.ts) — the tickets read anew afterwards. */
async function change(op: Op, ctx: Parameters<FlowAction["run"]>[1]) {
  ctx.may("send");
  if (ctx.dryRun) return { dryRun: true, would: op };
  const done = await (await import("./run")).runJiraOps([op], (line) => ctx.log(line));
  return { done: done.join("\n") };
}

export const JIRA_FLOW_ACTIONS: FlowAction[] = [
  {
    name: "jira.comment",
    group: "jira",
    label: "Comment on a Jira ticket",
    summary: "Writes a comment on a ticket in Jira (Zeff's Jira connection). Changes Jira: the flow needs “send”.",
    input: [
      { name: "ticket", type: "text", required: true, help: "The ticket's key, e.g. PROJ-123" },
      { name: "body", type: "text", required: true, help: "The comment (Markdown)" },
    ],
    output: "{ done } — what happened, in words",
    needs: ["send"],
    writes: true,
    run: (i, ctx) => change({ type: "jira-comment", ticket: ticketOf(i.ticket), body: String(i.body ?? "").trim() || (() => { throw new Error("The comment is empty."); })() }, ctx),
  },
  {
    name: "jira.transition",
    group: "jira",
    label: "Move a Jira ticket",
    summary: "Moves a ticket to a status (the transition that leads there, by its name or the status it goes to — e.g. “In Progress”, “Testing”, “Done”). Changes Jira: the flow needs “send”.",
    input: [
      { name: "ticket", type: "text", required: true, help: "The ticket's key" },
      { name: "to", type: "text", required: true, help: "The status (or the transition's name)" },
    ],
    output: "{ done }",
    needs: ["send"],
    writes: true,
    run: (i, ctx) => change({ type: "jira-transition", ticket: ticketOf(i.ticket), to: String(i.to ?? "").trim() }, ctx),
  },
  {
    name: "jira.assign",
    group: "jira",
    label: "Assign a Jira ticket",
    summary: "Gives a ticket to someone (their Jira user name). Changes Jira: the flow needs “send”.",
    input: [
      { name: "ticket", type: "text", required: true, help: "The ticket's key" },
      { name: "assignee", type: "text", required: true, help: "The Jira user name" },
    ],
    output: "{ done }",
    needs: ["send"],
    writes: true,
    run: (i, ctx) => change({ type: "jira-assign", ticket: ticketOf(i.ticket), assignee: String(i.assignee ?? "").trim() }, ctx),
  },
  {
    name: "jira.sync",
    group: "jira",
    label: "Sync the Jira tickets",
    summary: "Reads the tickets from Jira now (the chosen boards; Jira settings) — what Jira's app and the databases of Jira tickets show.",
    input: [],
    output: "{ done } — how many tickets were read",
    writes: true,
    run: async (_i, ctx) => {
      if (ctx.dryRun) return { dryRun: true, would: "sync" };
      const r = await (await import("@/lib/sync/registry")).syncAndWait("jira");
      if (!r.lastOk) throw new Error(r.lastMessage ?? "The sync failed.");
      return { done: r.lastMessage ?? "" };
    },
  },
];
