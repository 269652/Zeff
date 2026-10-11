import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { automationEnv, driverPath } from "../drivers";

/**
 * "Sign in" for Signal (on your click): Signal Desktop started in the tray with its debug port if it
 * isn't running — then it's linked or not (that's yours, with your phone). Server only.
 */
export async function openSignal(): Promise<{ ok: boolean; message: string }> {
  try {
    const { runStdioSession, resultToPayload } = await import("@/lib/jira/mcp-client");
    const out = await runStdioSession(
      { command: process.execPath, args: [driverPath("signal")], env: automationEnv(), label: "Signal" },
      async (call) => resultToPayload(await call("signal_status", { launch: true })),
      120000,
    );
    const r = (typeof out === "string" ? JSON.parse(out) : out) as { linked?: boolean; state?: string; message?: string };
    if (r.linked) return { ok: true, message: t("Signal Desktop is running with its debug port and linked.") };
    if (r.state === "link") return { ok: false, message: t("Signal Desktop isn't linked — open it (tray icon) and link it with your phone.") };
    return { ok: false, message: r.message ?? t("Signal Desktop isn't ready yet — try again in a moment.") };
  } catch (e) {
    return { ok: false, message: errorMessage(e).replace(/^Error:\s*/, "").slice(0, 300) };
  }
}
