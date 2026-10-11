/**
 * Runs once when a Zeff server starts (Node.js only, not while building): context items become
 * one item per linked source (see unifySources), work runs are picked up again, and the periodic
 * syncs start.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") return;
  try {
    const { unifySources } = await import("./lib/contexts");
    const { copies, split, merged } = unifySources();
    if (copies + split + merged) {
      console.log(`[context] one item per source: ${copies} copied message(s) cleared, ${split} item(s) split, ${merged} duplicate(s) merged`);
    }
  } catch (e) {
    console.error("[context] unifying linked sources failed", e);
  }
  try {
    const { failInterruptedRuns } = await import("./lib/boards/store");
    const { listAccounts, withAccount } = await import("./db/accounts");
    // A board run or recap can't outlive the server that ran it — in every account, not only the one you're in.
    for (const a of listAccounts()) withAccount(a.id, failInterruptedRuns);
  } catch (e) {
    console.error("[boards] marking interrupted runs failed", e);
  }
  try {
    const { keepCommentsFromRuns } = await import("./lib/jira/comments");
    keepCommentsFromRuns(); // once: the comments past runs read
  } catch (e) {
    console.error("[boards] keeping comments failed", e);
  }
  try {
    const { resumeWork } = await import("./lib/work/runner");
    resumeWork(); // workers that outlived the old server are watched again; the queue goes on
  } catch (e) {
    console.error("[work] resuming work runs failed", e);
  }
  try {
    const { writeKnowledgeInstances } = await import("./plugins/knowledge/instances");
    writeKnowledgeInstances(); // the launcher runs a knowledge server per account with the plugin
  } catch (e) {
    console.error("[knowledge] listing the knowledge servers failed", e);
  }
  const { startSyncScheduler } = await import("./lib/sync-scheduler");
  startSyncScheduler();
}
