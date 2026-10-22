import type { McpServer } from "@modelcontextprotocol/server";
import { allows, sourceLabel, refusal, TOOL_SOURCES, withClearance, type Clearance } from "@/lib/boundaries";
import { toolsAllowed } from "@/plugins/workspace/agent-tools";
import { getRoutine, routineOfWorkRun } from "@/plugins/workspace/routines";
import { callerRunId } from "./caller";

/**
 * Wraps the server's tools: the worker of an agent routine may use a tool only when its permissions allow the tool's group
 * (see plugins/workspace/agent-tools.ts). Everyone else — you, other agents, a session of your own — is let through.
 *
 * And the data boundaries (lib/boundaries): every request runs with a clearance — personal for a caller with no Zeff run
 * (you, a session of your own), personal for an agent routine's worker whose permissions allow personal data, open for any
 * other worker. A tool that reads one source only (Gmail, the time entries …) is refused when that source's label is beyond
 * it; secret is beyond every clearance. The tools that read several (search_context, the Workspace's) filter by it.
 */
export function guardTools(server: McpServer): void {
  const register = server.registerTool.bind(server) as (name: string, def: unknown, handler: (...a: unknown[]) => unknown) => unknown;
  (server as unknown as { registerTool: typeof register }).registerTool = (name, def, handler) =>
    register(name, def, async (...args: unknown[]) => {
      const run = callerRunId();
      const pageId = run ? routineOfWorkRun(run) : null;
      const routine = pageId ? getRoutine(pageId) : null;
      if (routine && routine.kind === "agent" && !toolsAllowed(routine.permissions, name)) {
        return { content: [{ type: "text", text: `This agent may not use ${name}: its permissions (the Permissions tab of its page) don't allow it.` }], isError: true };
      }
      const clearance: Clearance = !run || (routine?.kind === "agent" && routine.permissions.personal === true) ? "personal" : "open";
      const source = TOOL_SOURCES[name];
      const label = source ? sourceLabel(source) : "open";
      if (!allows(clearance, label)) return { content: [{ type: "text", text: refusal(label, `What ${name} reads`) }], isError: true };
      return withClearance(clearance, () => handler(...args));
    });
}
