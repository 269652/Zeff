/**
 * Runs once when a Zeff server starts (Node.js only, not while building): context items become
 * one item per linked source (see unifySources), work runs are picked up again, and the periodic
 * syncs start.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") return;
  // The sync host (see lib/host/role.ts) does only what the web server hands it: the scheduler and the runs.
  // Resuming work runs, documents, the plugin event watcher … stay with the web server — twice would be wrong.
  if (process.env.ZEFF_ROLE === "sync") {
    try {
      const { failInterruptedRuns } = await import("./lib/boards/store");
      const { listAccounts, withAccount } = await import("./db/accounts");
      // A board run or recap can't outlive the server that ran it — this one, now.
      for (const a of listAccounts()) withAccount(a.id, failInterruptedRuns);
    } catch (e) {
      console.error("[sync host] marking interrupted runs failed", e);
    }
    const { startSyncScheduler } = await import("./lib/sync-scheduler");
    startSyncScheduler();
    console.log("[sync host] the scheduler and the runs are here now");
    return;
  }
  try {
    const { unifySources } = await import("./lib/contexts");
    const { copies, split, merged } = unifySources();
    if (copies + split + merged) {
      console.log(`[context] one item per source: ${copies} copied message(s) cleared, ${split} item(s) split, ${merged} duplicate(s) merged`);
    }
  } catch (e) {
    console.error("[context] unifying linked sources failed", e);
  }
  const { runsWork, delegates } = await import("./lib/host/role");
  // A web server with a sync host: the briefing, the syncs and the recap run there, not here — so a restart of this
  // server interrupts none of them (and doesn't fail their rows). It copies what the host is doing instead.
  if (delegates()) (await import("./lib/host/mirror")).startHostMirror();
  try {
    if (!runsWork()) throw new Error("skipped");
    const { failInterruptedRuns } = await import("./lib/boards/store");
    const { listAccounts, withAccount } = await import("./db/accounts");
    // A board run or recap can't outlive the server that ran it — in every account, not only the one you're in.
    for (const a of listAccounts()) withAccount(a.id, failInterruptedRuns);
  } catch (e) {
    if (!(e instanceof Error && e.message === "skipped")) console.error("[boards] marking interrupted runs failed", e);
  }
  try {
    // Documents a server that has gone left "being read": waiting again, and read — in every account that keeps documents.
    const { listAccounts, withAccount } = await import("./db/accounts");
    const { isInstalled } = await import("./plugins/state");
    for (const a of listAccounts()) {
      await withAccount(a.id, async () => {
        if (!isInstalled("documents")) return;
        const { readingDocuments } = await import("./plugins/documents/store");
        if (readingDocuments().length) (await import("./plugins/documents/process")).startProcessing();
      });
    }
  } catch (e) {
    console.error("[documents] picking up the waiting documents failed", e);
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
  try {
    const { startExtWatcher } = await import("./lib/ext/work");
    startExtWatcher(); // external plugins' work.changed / todos.changed events
  } catch (e) {
    console.error("[ext] starting the event watcher failed", e);
  }
  if (runsWork()) {
    const { startSyncScheduler } = await import("./lib/sync-scheduler");
    startSyncScheduler();
  }
}
