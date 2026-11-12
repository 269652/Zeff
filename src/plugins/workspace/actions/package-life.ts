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
