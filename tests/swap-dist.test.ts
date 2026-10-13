import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SYNC, copyForSyncHost, swapDists } from "../scripts/swap-dist.mjs";

// The deploy's two swaps: the pages' build (.next) and the sync host's own (.next-sync) — the host's is
// a copy of the same build, taken over when the host has nothing to do; the pages' folder isn't touched by it.
const write = (file: string, text: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const read = (file: string) => fs.readFileSync(file, "utf8");

test("the sync host's build is a copy of the new build (not its cache), taken over beside the pages' build", async () => {
  const app = fs.mkdtempSync(path.join(os.tmpdir(), "zeff-swap-"));
  try {
    // The live pages' build and the sync host's old build.
    write(path.join(app, ".next", "BUILD_ID"), "live");
    write(path.join(app, ".next", "server", "page.js"), "live page");
    write(path.join(app, ".next-sync", "BUILD_ID"), "old host");
    write(path.join(app, ".next-sync", "server", "page.js"), "old host page");
    // The new build, with its cache.
    write(path.join(app, ".next-build", "server", "page.js"), "new page");
    write(path.join(app, ".next-build", "cache", "big"), "x");
    write(path.join(app, ".next-build", "BUILD_ID"), "new");

    copyForSyncHost(app);
    assert.equal(read(path.join(app, SYNC.STAGE, "server", "page.js")), "new page");
    assert.equal(read(path.join(app, SYNC.STAGE, "BUILD_ID")), "new");
    assert.equal(fs.existsSync(path.join(app, SYNC.STAGE, "cache")), false, "the build's cache stays out");
    assert.equal(read(path.join(app, ".next-build", "server", "page.js")), "new page", "the build for the pages is untouched");

    let stopped = 0;
    await swapDists(
      [app],
      () => {
        stopped++;
        // While the old host is stopped it has no marker: the launcher can't bring it back onto a half-swapped folder.
        assert.equal(fs.existsSync(path.join(app, SYNC.LIVE, "BUILD_ID")), false);
      },
      SYNC,
    );
    assert.equal(stopped, 1);
    assert.equal(read(path.join(app, SYNC.LIVE, "server", "page.js")), "new page");
    assert.equal(read(path.join(app, SYNC.LIVE, "BUILD_ID")), "new");
    assert.equal(read(path.join(app, SYNC.OLD, "server", "page.js")), "old host page");
    assert.equal(read(path.join(app, ".next", "server", "page.js")), "live page", "the pages' build isn't moved by the host's swap");
    assert.equal(read(path.join(app, ".next-build", "BUILD_ID")), "new");
  } finally {
    fs.rmSync(app, { recursive: true, force: true });
  }
});

test("a swap without a finished build changes nothing", async () => {
  const app = fs.mkdtempSync(path.join(os.tmpdir(), "zeff-swap-"));
  try {
    write(path.join(app, ".next-sync", "BUILD_ID"), "old host");
    write(path.join(app, SYNC.STAGE, "server", "half.js"), "no marker yet");
    await assert.rejects(() => swapDists([app], () => {}, SYNC), /kein fertiger Build/);
    assert.equal(read(path.join(app, ".next-sync", "BUILD_ID")), "old host");
  } finally {
    fs.rmSync(app, { recursive: true, force: true });
  }
});
