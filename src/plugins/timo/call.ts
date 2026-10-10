import { watchSignIn } from "@/app/action-helpers";
import { automationEnv, driverPath } from "@/plugins/drivers";

/** TimO's driver (the same automation Chrome), one tool call — watched for "sign in first". Server-only. */
export async function callTimo(tool: "timo_status" | "timo_days" | "timo_export", args: Record<string, unknown>): Promise<string> {
  const { runStdioSession, resultToPayload } = await import("@/lib/jira/mcp-client");
  const script = driverPath("timo");
  return watchSignIn("timo", async () => {
    const out = await runStdioSession(
      { command: process.execPath, args: [script], env: automationEnv(), label: tool === "timo_days" ? "TimO pull" : "TimO export" },
      async (call) => resultToPayload(await call(tool, args)),
      240000,
    );
    return typeof out === "string" ? out : JSON.stringify(out);
  });
}
