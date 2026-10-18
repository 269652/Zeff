import type { McpServer } from "@modelcontextprotocol/server";
import { toolsAllowed } from "@/plugins/workspace/agent-tools";
import { getRoutine, routineOfWorkRun } from "@/plugins/workspace/routines";
import { callerRunId } from "./caller";

/**
 * Wraps the server's tools: the worker of an agent routine may use a tool only when its permissions allow the tool's group
 * (see plugins/workspace/agent-tools.ts). Everyone else — you, other agents, a session of your own — is let through.
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
      return handler(...args);
    });
}
