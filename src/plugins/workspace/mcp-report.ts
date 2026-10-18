/**
 * The agent's report tool (over the MCP): the worker of an agent routine writes the report of its session — one per session, a
 * follow-up changes it — and it is final when the user gives their OK (ticks the todo off). Server only.
 */
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { callerRunId } from "@/mcp/caller";
import { saveReport } from "./routine-reports";

type Result = { content: { type: "text"; text: string }[]; isError?: boolean };
type Helpers = { run: (fn: () => Promise<Result> | Result) => Promise<Result>; ok: (text: string) => Result; fail: (text: string) => Result };

export function registerReportTool(server: McpServer, { run, ok, fail }: Helpers): void {
  server.registerTool(
    "agent_report",
    {
      title: "Write your report",
      description:
        "For an agent routine's worker: writes the REPORT of this session (markdown): what you did, what you found, what is open. One report per session — call it again after a follow-up and it replaces the text. It is a draft until the user gives their OK (ticks your todo off); then it is final on the routine's Reports tab.",
      inputSchema: z.object({ title: z.string().min(1).describe("A short title"), body: z.string().min(1).describe("The report, markdown") }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async (args) =>
      run(async () => {
        const report = saveReport(callerRunId() ?? 0, args);
        if (!report) return fail("This tool is for the worker of an agent routine (a page made an agent in the Workspace) — there is no report to write here.");
        return ok(`Report saved as a draft (${report.status}). It becomes final when the user ticks the todo off.`);
      }),
  );
}
