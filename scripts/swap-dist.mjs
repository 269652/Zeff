/**
 * The swap behind `npm run deploy`: no broken window while building.
 *
 * `next build` into .next while prod (next start) serves from it breaks prod for the whole build:
 * the old server lazily loads chunks that are gone or new ("ChunkLoadError: Failed to load chunk
 * server/chunks/ssr/…"). So the deploy builds into a side folder (.next-build, via
 * ZEFF_DIST_DIR in next.config.ts) and only swaps it in around the restart:
 *   1. .next/BUILD_ID leaves first — the launcher starts a server only when it's there, so it
 *      can't bring one back onto a half-swapped folder
 *   2. the old server is stopped (stop())
 *   3. the rest of the old build moves to .next-old, the new one in, BUILD_ID last
 * A failed step moves everything back. Same folder, so every move is a rename (milliseconds).
 * Stays in .next: `dev` (next dev's own folder, Next 16) and `cache` (next start's). The build's
 * own cache stays in .next-build/cache for the next deploy.
 */
import fs from "node:fs";
import path from "node:path";

export const LIVE = ".next";
export const STAGE = ".next-build";
export const OLD = ".next-old";
/** The sync host's build (a second server from the same code, see lib/host/role.ts) swaps in its own folders: the deploy moves .next under the pages' server, never under the host. */
export const SYNC = { LIVE: ".next-sync", STAGE: ".next-sync-build", OLD: ".next-sync-old" };
const KEEP = new Set(["dev", "cache"]);
const MARKER = "BUILD_ID";

const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** A rename, retried briefly: on Windows a virus scan or an indexer holds files for a moment. */
function rename(from, to) {
  for (let i = 0; ; i++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (e) {
      if (i >= 30 || !["EPERM", "EBUSY", "EACCES"].includes(e.code)) throw e;
      pause(100);
    }
  }
}

/**
 * Before the checks: what an earlier, failed deploy left in .next-build goes (all but the build
 * cache) — tsconfig.json includes .next-build/types, and stale route types would fail tsc.
 */
export function clearStage(appDir, names = { STAGE }) {
  const stage = path.join(appDir, names.STAGE);
  if (!fs.existsSync(stage)) return;
  for (const name of fs.readdirSync(stage)) if (name !== "cache") fs.rmSync(path.join(stage, name), { recursive: true, force: true, maxRetries: 5 });
}

/** A finished build in .next-build — or why not. */
export function stagedProblem(appDir, names = { STAGE }) {
  const stage = path.join(appDir, names.STAGE);
  return fs.existsSync(path.join(stage, MARKER)) ? null : `${path.relative(process.cwd(), stage) || stage}: kein fertiger Build (${MARKER} fehlt)`;
}

/**
 * Swaps .next-build into .next for each app folder; stop() stops the old servers in between.
 * The build before last (.next-old) is removed first, while the old server still runs.
 */
export async function swapDists(appDirs, stop, names = { LIVE, STAGE, OLD }) {
  const { LIVE, STAGE, OLD } = names;
  for (const app of appDirs) {
    const problem = stagedProblem(app, names);
    if (problem) throw new Error(problem);
    fs.rmSync(path.join(app, OLD), { recursive: true, force: true, maxRetries: 5 });
  }
  const moved = [];
  const move = (from, to) => {
    rename(from, to);
    moved.push([from, to]);
  };
  try {
    for (const app of appDirs) {
      fs.mkdirSync(path.join(app, OLD));
      const marker = path.join(app, LIVE, MARKER);
      if (fs.existsSync(marker)) move(marker, path.join(app, OLD, MARKER));
    }
    await stop();
    for (const app of appDirs) {
      const live = path.join(app, LIVE);
      const stage = path.join(app, STAGE);
      fs.mkdirSync(live, { recursive: true });
      for (const name of fs.readdirSync(live)) if (!KEEP.has(name)) move(path.join(live, name), path.join(app, OLD, name));
      const incoming = fs.readdirSync(stage).filter((n) => n !== "cache" && n !== MARKER);
      for (const name of [...incoming, MARKER]) move(path.join(stage, name), path.join(live, name));
    }
  } catch (e) {
    // Everything back where it was — the launcher then starts the old build again.
    for (const [from, to] of moved.reverse()) {
      try {
        rename(to, from);
      } catch (err) {
        console.error(`[swap] ✖ ${to} → ${from}: ${err.message}`);
      }
    }
    throw e;
  }
}

/**
 * A copy of the finished build for the sync host: .next-build → .next-sync-build (what the web swap is about to
 * move away). Not the build's cache. The host takes it over when it has nothing to do (see deploy.mjs).
 */
export function copyForSyncHost(appDir) {
  const from = path.join(appDir, STAGE);
  const to = path.join(appDir, SYNC.STAGE);
  fs.rmSync(to, { recursive: true, force: true, maxRetries: 5 });
  fs.mkdirSync(to, { recursive: true });
  for (const name of fs.readdirSync(from)) {
    if (name === "cache" || name === "dev" || name === MARKER) continue;
    fs.cpSync(path.join(from, name), path.join(to, name), { recursive: true });
  }
  // The marker last: a half copy is never taken for a build.
  fs.copyFileSync(path.join(from, MARKER), path.join(to, MARKER));
}
