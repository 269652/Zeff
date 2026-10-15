/**
 * Runs once when a Zeff server starts (Node.js only, not while building): context items become
 * one item per linked source (see unifySources), work runs are picked up again, and the periodic
 * syncs start.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") return;
  // A big streamed page makes Next's gzip stream collect drain listeners while it waits for the socket: Node warned about
  // "a possible memory leak" on every such page (thousands of lines that hid the real errors in the log). They go when the
  // response ends, so the limit is raised — a true leak still shows, only later.
  (await import("node:events")).EventEmitter.defaultMaxListeners = 50;
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
  try {
    // The lock (Settings → Lock): the key watcher ends every session the moment the security key is pulled out.
    const { lockEnabled } = await import("./lib/lock/shared");
    if (lockEnabled()) (await import("./lib/lock/detect")).startKeyWatch();
  } catch (e) {
    console.error("[lock] starting the key watcher failed", e);
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
    // Once: Kanban's boards move into the Workspace (a copy of the database first) — in every account.
    const { listAccounts, withAccount } = await import("./db/accounts");
    const { moveAllBoardsOnce } = await import("./plugins/kanban/to-workspace");
    for (const a of listAccounts()) {
      const r = await withAccount(a.id, moveAllBoardsOnce);
      if (r?.moved || r?.failed) console.log(`[kanban] ${a.name}: ${r.moved} board(s) moved into the Workspace${r.failed ? `, ${r.failed} failed (tried again at the next start)` : ""} — backup: ${r.backup}`);
    }
  } catch (e) {
    console.error("[kanban] moving the boards into the Workspace failed", e);
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
