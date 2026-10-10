import { watchSignIn } from "@/app/action-helpers";
import { automationEnv, driverPath } from "@/plugins/drivers";

/** Roar's driver (Playwright over the automation Chrome, no LLM), one tool call — watched for "sign in first". Server-only. */
export async function callRoar(tool: "roar_status" | "roar_export" | "roar_jobs" | "roar_pull", args: Record<string, unknown>): Promise<string> {
  const { runStdioSession, resultToPayload } = await import("@/lib/jira/mcp-client");
  const script = driverPath("roar");
  return watchSignIn("roar", async () => {
    const out = await runStdioSession(
      { command: process.execPath, args: [script], env: automationEnv(), label: tool === "roar_jobs" ? "Roar job sync" : tool === "roar_pull" ? "Roar pull" : "Roar export" },
      async (call) => resultToPayload(await call(tool, args)),
      tool === "roar_export" ? 600000 : 180000, // a full week's export can take minutes
    );
    return typeof out === "string" ? out : JSON.stringify(out);
  });
}
