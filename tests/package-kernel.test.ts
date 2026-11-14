import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/** A package says which kernel contract it was made for (docs/kernel-contract.md): a newer one is refused; before a kernel update, the apps it couldn't run are named. */
test("a package made for a newer kernel is refused; the apps a kernel couldn't run are named", async () => {
  await import("@/lib/ext/registry"); // (first: see tests/safe-mode.test.ts)
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("workspace", true);
  await import("@/plugins/contributions");
  const life = await import("@/plugins/workspace/package-life");
  const { CONTRACT_VERSION } = await import("@/lib/kernel/contract");
  const pkg = (id: string, kernel?: number) => ({ format: 1 as const, id, name: id, version: "1.0.0", ...(kernel ? { kernel } : {}), items: [{ id: "i1", kind: "page", title: id }] });
  assert.match(life.checkRequirements(pkg("future", CONTRACT_VERSION + 1) as never).join(" "), /newer Zeff/);
  await assert.rejects(life.installTracked(pkg("future", CONTRACT_VERSION + 1) as never, null), /newer Zeff/);
  await life.installTracked(pkg("today", CONTRACT_VERSION) as never, null);
  await life.installTracked(pkg("plain") as never, null);
  assert.deepEqual(life.appsBlockingKernel(CONTRACT_VERSION), []);
  // A kernel that spoke only an older contract couldn't run "today" (made for this one); "plain" (made for 1) it could.
  if (CONTRACT_VERSION > 1) assert.deepEqual(life.appsBlockingKernel(CONTRACT_VERSION - 1).map((a) => a.id), ["today"]);
  assert.equal(life.kernelProblem({ name: "x", kernel: 5 }, 4)?.includes("newer Zeff"), true);
  assert.equal(life.kernelProblem({ name: "x" }, 4), null);
});
