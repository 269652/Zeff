import { automationEnv, automationUp, driverPath } from "@/plugins/drivers";
import { driverOf } from "@/lib/connectors/store";
import { clearAttention, needsSignIn, raiseLogin } from "@/lib/attention";
import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { getGitlabSettings, saveGitlabItems, updateGitlabSettings, type GitlabItemInput } from "./store";

/** How far back a full sync (and branches on every sync) goes. */
const DAYS = 90;

/** One sync at a time across the whole server (actions and the scheduler are separate module copies). */
const state = globalThis as { __zeffGitlabSyncing?: boolean };

/** Remember how the sync went, for the GitLab page (and the scheduler's next turn). */
function record(ok: boolean, message: string): { ok: boolean; message: string } {
  updateGitlabSettings({ lastSyncAt: new Date().toISOString(), lastResult: message, lastOk: ok });
  return { ok, message };
}

/** Whether the automation Chrome runs — the background sync never starts it (it opens a GitLab tab there, though). */
async function chromeUp(): Promise<boolean> {
  return automationUp("gitlab");
}

/**
 * Read your merge requests, their comments (yours too) and your branches from GitLab —
 * GET requests from a GitLab tab in the automation Chrome (src/plugins/gitlab/driver.mjs) — and keep
 * them. After a sync that worked, only what changed since (a day's overlap) is read again.
 * `background`: only when Chrome runs with GitLab open; by hand it may open GitLab.
 */
export async function syncGitlab({ background = false } = {}): Promise<{ ok: boolean; message: string }> {
  if (state.__zeffGitlabSyncing) return { ok: false, message: t("A GitLab sync is already running.") };
  state.__zeffGitlabSyncing = true;
  try {
    const s = getGitlabSettings();
    const base = s.baseUrl.replace(/\/+$/, "");
    // In the background without the automation Chrome: later, as for the other sources — not a failure.
    const viaApi = driverOf("gitlab") === "api";
    if (!viaApi && background && !(await chromeUp())) return { ok: true, message: t("The automation Chrome isn't running — later.") };
    const sinceIso = s.lastOk && s.lastSyncAt ? new Date(new Date(s.lastSyncAt).getTime() - 864e5).toISOString() : undefined;
    let data: { items?: GitlabItemInput[] };
    if (viaApi) data = await (await import("./api")).readItems({ sinceIso, days: DAYS });
    else {
      const { runStdioSession, resultToPayload } = await import("@/lib/jira/mcp-client");
      const script = driverPath("gitlab");
      const out = await runStdioSession(
        { command: process.execPath, args: [script], env: automationEnv(), label: "GitLab sync" },
        // GitLab not open: a tab for it (Chrome itself started only by hand).
        async (call) => resultToPayload(await call("gitlab_items", { baseUrl: base, sinceIso, days: DAYS, openIfMissing: true, launch: !background })),
        240000,
      );
      data = (typeof out === "string" ? JSON.parse(out) : out) as { items?: GitlabItemInput[] };
      if (!Array.isArray(data.items)) throw new Error(typeof out === "string" ? out.slice(0, 300) : t("GitLab returned nothing readable."));
    }
    const items = data.items ?? [];
    const { added, total } = saveGitlabItems(items);
    // Merge todos waiting for an approval: theirs is in.
    const { promoteApprovedMerges } = await import("@/lib/boards/store");
    promoteApprovedMerges(new Set(items.filter((i) => i.kind === "mr" && /approved/.test(i.state ?? "")).map((i) => i.key)));
    // Merge requests a todo asks to open (none open for the branch, as now synced): their button.
    try {
      await (await import("@/lib/boards/delivery-ops")).attachOpenMrOps();
      (await import("@/lib/boards/todo-rules")).applyTodoRules();
    } catch {
      // without buttons, then
    }
    // The feature branches and merge requests of the work on open todos (now synced): linked as their context.
    try {
      const { listTodos } = await import("@/lib/boards/store");
      (await import("@/lib/work/branch-context")).linkBranchContext(listTodos({ status: "open" }).map((x) => x.id));
    } catch {
      // without the links, then
    }
    clearAttention("login:gitlab");
    return record(true, t("{added} new · {total} in all", { added, total }));
  } catch (e) {
    const message = errorMessage(e).slice(0, 300);
    // GitLab wants you to sign in (not just unreachable): asked of you, and pinged.
    if (driverOf("gitlab") === "cdp" && needsSignIn(message) && !/reachable/i.test(message)) raiseLogin("gitlab", message);
    return record(false, message);
  } finally {
    state.__zeffGitlabSyncing = false;
  }
}
