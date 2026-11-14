"use server";

import { run } from "./shared";

// ---------------------------------------------------------------------------
// Packages that live (package-life.ts): what is installed, update in place, roll back, tests, permissions
// ---------------------------------------------------------------------------

export async function listInstalledPackagesAction() {
  return run(async () => ({ packages: await (await import("../package-life")).packageStatus() }));
}

export async function packagePermissionsAction(key: string) {
  return run(async () => {
    const life = await import("../package-life");
    const pkg = await life.findOffered(String(key));
    if (!pkg) throw new Error("There is no such package on offer.");
    return { name: pkg.name, version: pkg.version ?? "", problems: life.checkRequirements(pkg), permissions: life.packagePermissions(pkg) };
  });
}

export async function installOfferedPackageAction(key: string, parentId: number | null = null) {
  return run(async () => {
    const life = await import("../package-life");
    const pkg = await life.findOffered(String(key));
    if (!pkg) throw new Error("There is no such package on offer.");
    const r = await life.installTracked(pkg, parentId === null ? null : Number(parentId));
    return { id: r.rootId, tests: r.tests };
  });
}

export async function updateInstalledPackageAction(id: string, force = false) {
  return run(async () => {
    const life = await import("../package-life");
    const pkg = await life.offeredPackage(String(id));
    if (!pkg) throw new Error("No newer package is on offer for this one.");
    return { report: await life.updateTracked(String(id), pkg, { force: force === true }) };
  });
}

export async function packageHistoryAction(id: string) {
  return run(async () => {
    const life = await import("../package-life");
    const p = life.getInstalled(String(id));
    if (!p) throw new Error("This package is not installed.");
    return { name: p.name, version: p.version, history: p.history, versionsKept: life.versionsKept(p.id) };
  });
}

export async function rollbackPackageAction(id: string, version: string) {
  return run(async () => ({ report: await (await import("../package-life")).rollbackTracked(String(id), String(version)) }));
}

export async function testPackageAction(id: string) {
  return run(async () => ({ results: await (await import("../package-life")).runPackageTests(String(id)) }));
}

/**
 * A newer version of the package this database belongs to (one of its pages, made by installing it): what the note in its views offers.
 * Learn's comes with Zeff itself (its bundled files newer than what is installed). null: none, or the database belongs to no package.
 */
export async function packageUpdateOfAction(dbId: number) {
  return run(async () => {
    const { listInstalled, compareVersions, offeredPackage } = await import("../package-life");
    const inst = listInstalled().find((p) => p.rootId === Number(dbId) || Object.values(p.map).includes(Number(dbId)));
    if (!inst) return { update: null };
    if (inst.id === "learn-ext") {
      const u = await (await import("@/plugins/learn/setup")).learnUpdate();
      if (u) return { update: { id: inst.id, name: inst.name, ...u } };
    }
    const offered = await offeredPackage(inst.id);
    const newer = offered?.version && compareVersions(offered.version, inst.version) > 0;
    return { update: newer ? { id: inst.id, name: inst.name, from: inst.version, to: offered!.version! } : null };
  });
}

/** That newer version brought in (the note's button): Learn as "Set up Learn" does it (its files, its package, what it asks for), any other package updated in place. */
export async function bringPackageUpdateAction(id: string) {
  return run(async () => {
    if (String(id) === "learn-ext") return { done: await (await import("@/plugins/learn/setup")).setupLearn() };
    const life = await import("../package-life");
    const pkg = await life.offeredPackage(String(id));
    if (!pkg) throw new Error("No newer package is on offer for this one.");
    const r = await life.updateTracked(String(id), pkg);
    return { done: [`${r.from} → ${r.to}`] };
  });
}
