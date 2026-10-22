/**
 * The open loops for agents (over the MCP): what you owe, what you are owed, overdue — read-only, there while the loops plugin is
 * installed. Each loop's source carries its label (lib/boundaries): an agent sees only what its clearance allows (a worker without the
 * permission for personal data: no WhatsApp, Signal …; secret: nobody); the answer says how many were left out. Server only.
 */
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { mayRead, sourceLabel } from "@/lib/boundaries";
import { isInstalled } from "@/plugins/state";

type Result = { content: { type: "text"; text: string }[]; isError?: boolean };
type Helpers = { run: (fn: () => Promise<Result> | Result) => Promise<Result>; ok: (text: string) => Result; fail: (text: string) => Result };

export function registerLoopTools(server: McpServer, { run, ok, fail }: Helpers): void {
  server.registerTool(
    "open_loops",
    {
      title: "Open loops: what is owed, by whom",
      description:
        "What is still open between the user and others, across mail, chats, Teams and Jira: promises the user made (direction mine — the user owes it) and promises made to the user (theirs — they owe it), questions and review/sign requests to the user nobody answered, the user's own questions without an answer, Jira comments addressed to the user. Each line: who owes, kind (promise, question, request, mention), the person, what, since when, the due day, overdue, unconfirmed (an AI reading the user hasn't confirmed), the quote and where it was said. Filter by direction (mine | theirs), overdue, a person (name or person:<id>). Closed loops: view closed. Read-only.",
      inputSchema: z.object({
        direction: z.enum(["mine", "theirs", "all"]).optional(),
        overdue: z.boolean().optional(),
        closed: z.boolean().optional().describe("The loops closed in the last two weeks instead (and what closed them)."),
        person: z.string().optional().describe("A person's name, alias or person:<id>"),
        limit: z.number().int().min(1).max(200).optional(),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args) =>
      run(async () => {
        if (!isInstalled("loops")) return fail("The Open loops plugin is not installed in Zeff (Menu → Plugins) — this tool isn't available.");
        const { listLoops } = await import("./query");
        let personId: number | undefined;
        if (args.person) {
          const { resolveQuery } = await import("@/plugins/timeline/refs");
          const hit = resolveQuery(args.person);
          if (!hit || !hit.ref.startsWith("person:")) return fail(`No person known by "${args.person}".`);
          personId = Number(hit.ref.slice("person:".length));
        }
        const view = args.closed ? "closed" : args.overdue ? "overdue" : args.direction === "mine" || args.direction === "theirs" ? args.direction : undefined;
        let loops = listLoops({ view, personId });
        if (view === "overdue" && (args.direction === "mine" || args.direction === "theirs")) loops = loops.filter((l) => l.direction === args.direction);
        const labels = new Map<string, boolean>();
        const readable = (source: string) => {
          if (!labels.has(source)) labels.set(source, mayRead(sourceLabel(source)));
          return labels.get(source)!;
        };
        const shown = loops.filter((l) => readable(l.source));
        const hidden = loops.length - shown.length;
        const list = shown.slice(0, args.limit ?? 50);
        const line = (l: (typeof list)[number]) =>
          [
            `${l.direction === "mine" ? "I owe" : "They owe"} · ${l.kind === "commitment" ? "promise" : l.kind}`,
            `${l.who}${l.personId ? ` [person:${l.personId}]` : ""}`,
            l.text,
            `since ${l.at.slice(0, 10)}${l.due ? `, due ${l.due}` : ""}${l.overdue ? ", OVERDUE" : ""}${l.confirmed ? "" : ", unconfirmed"}`,
            l.quote && l.quote !== l.text ? `“${l.quote.slice(0, 200)}”` : "",
            l.state === "closed" ? `closed by ${l.closedBy}${l.closeQuote ? `: “${l.closeQuote.slice(0, 160)}”` : ""}` : l.proposal ? `maybe kept: “${l.proposal.quote.slice(0, 160)}”` : "",
            `${l.source} ${l.sourceRef}`,
            l.href,
            `[${l.ref}]`,
          ]
            .filter(Boolean)
            .join(" | ");
        const head = `${list.length} of ${shown.length} loop(s)${hidden ? ` — ${hidden} hidden: their sources are beyond this caller's data boundaries (personal or secret)` : ""}.`;
        return ok([head, ...list.map(line)].join("\n"));
      }),
  );
}
