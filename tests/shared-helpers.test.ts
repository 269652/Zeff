import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import { killPid, sleep } from "../src/lib/abort";
import { runCapture, tail } from "../src/lib/exec";
import { gitText } from "../src/lib/git";
import { clip, isoDay, pad2, truncate } from "../src/lib/text";

test("pad2 and isoDay", () => {
  assert.equal(pad2(7), "07");
  assert.equal(pad2(12), "12");
  assert.equal(isoDay(new Date(2026, 0, 5)), "2026-01-05");
  assert.equal(isoDay(new Date(2026, 11, 31, 23, 59)), "2026-12-31");
});

test("clip flattens whitespace and cuts with an ellipsis after n characters", () => {
  assert.equal(clip("  a \n\n b\tc  ", 50), "a b c");
  assert.equal(clip("abcdefghij", 4), "abcd…");
  assert.equal(clip("abcd", 4), "abcd");
  assert.equal(clip(null, 4), "");
  assert.equal(clip(undefined, 4), "");
});

test("truncate keeps n characters in all, the ellipsis included", () => {
  assert.equal(truncate("abcdefghij", 5), "abcd…");
  assert.equal(truncate("abcde", 5), "abcde");
  assert.equal(truncate("ab cdefghij", 4), "ab…"); // the space before the cut goes
});

test("tail keeps the last 400 characters, trimmed", () => {
  assert.equal(tail("  hi \n"), "hi");
  assert.equal(tail("x".repeat(1000)).length, 400);
});

test("runCapture says whether it worked and what it printed", async () => {
  const ok = await runCapture(process.execPath, ["-e", "console.log('out'); console.error('err')"], { timeout: 20000 });
  assert.equal(ok.ok, true);
  assert.match(ok.out, /out/);
  assert.match(ok.out, /err/);
  const bad = await runCapture(process.execPath, ["-e", "console.error('nope'); process.exit(3)"], { timeout: 20000 });
  assert.equal(bad.ok, false);
  assert.match(bad.out, /nope/);
  const env = await runCapture(process.execPath, ["-e", "console.log(process.env.ZEFF_TEST_X)"], { timeout: 20000, env: { ZEFF_TEST_X: "val" } });
  assert.match(env.out, /val/);
  const missing = await runCapture("zeff-no-such-program", [], { timeout: 5000 });
  assert.equal(missing.ok, false);
});

test("gitText gives trimmed output, and an empty string on any failure", async () => {
  assert.match(await gitText(process.cwd(), ["--version"]), /^git version/);
  assert.equal(await gitText(process.cwd(), ["no-such-subcommand"]), "");
  assert.equal(await gitText("Z:/this/folder/does/not/exist", ["status"]), "");
});

test("sleep waits and killPid ends a process", async () => {
  const t0 = Date.now();
  await sleep(30);
  assert.ok(Date.now() - t0 >= 25);
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore", windowsHide: true });
  const exited = new Promise<void>((r) => child.on("exit", () => r()));
  await sleep(200);
  killPid(child.pid!);
  await exited;
  assert.ok(child.exitCode !== null || child.signalCode !== null);
  killPid(child.pid!); // gone already: no throw
});
