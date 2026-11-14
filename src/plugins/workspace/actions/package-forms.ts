"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "@/lib/redirect";
import { t } from "@/lib/i18n/server";

// The buttons of Workspace settings → Packages: each does its thing and comes back to the page with a sentence.

const back = (msg: string): never => {
  revalidatePath("/workspace/settings/packages");
  return redirect(`/workspace/settings/packages?ok=${encodeURIComponent(msg)}`);
};
const tests = (r: { ok: boolean }[]) => (r.length ? ` ${t("Tests")}: ${r.filter((x) => x.ok).length}/${r.length}.` : "");
const said = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function installPackageFormAction(fd: FormData): Promise<void> {
  let msg: string;
  try {
    const life = await import("../package-life");
    const pkg = await life.findOffered(String(fd.get("key") ?? ""));
    if (!pkg) throw new Error(t("There is no such package on offer."));
    const r = await life.installTracked(pkg, null, { allow: fd.get("allow") === "1" });
    msg = t("Installed.") + (r.allowed.length ? ` ${t("Allowed for its flows")}: ${r.allowed.join(", ")}.` : "") + tests(r.tests);
  } catch (e) {
    msg = said(e);
  }
  return back(msg);
}

export async function updatePackageFormAction(fd: FormData): Promise<void> {
  let msg: string;
  try {
    const life = await import("../package-life");
    const id = String(fd.get("id") ?? "");
    const pkg = await life.offeredPackage(id);
    if (!pkg) throw new Error(t("No newer package is on offer for this one."));
    const r = await life.updateTracked(id, pkg, { force: fd.get("force") === "1" });
    msg = `${r.from} → ${r.to}: ${r.changes.length} ${t("changes")}, ${r.kept.length} ${t("kept as yours")}.${tests(r.tests)}`;
  } catch (e) {
    msg = said(e);
  }
  return back(msg);
}

export async function rollbackPackageFormAction(fd: FormData): Promise<void> {
  let msg: string;
  try {
    const r = await (await import("../package-life")).rollbackTracked(String(fd.get("id") ?? ""), String(fd.get("version") ?? ""));
    msg = `${r.from} → ${r.to}.${tests(r.tests)}`;
  } catch (e) {
    msg = said(e);
  }
  return back(msg);
}

export async function testPackageFormAction(fd: FormData): Promise<void> {
  let msg: string;
  try {
    const r = await (await import("../package-life")).runPackageTests(String(fd.get("id") ?? ""));
    msg = r.length ? r.map((x) => `${x.ok ? "✓" : "✗"} ${x.name}${x.ok ? "" : ` (${x.detail})`}`).join(" · ") : t("This package ships no tests.");
  } catch (e) {
    msg = said(e);
  }
  return back(msg);
}

/** A kept version as a separate app (or one of your templates) beside the installed one. */
export async function snapshotAsNewFormAction(fd: FormData): Promise<void> {
  let msg: string;
  try {
    const template = fd.get("template") === "1";
    const r = await (await import("../package-life")).snapshotAsNew(String(fd.get("id") ?? ""), String(fd.get("version") ?? ""), { template });
    msg = template ? t("Saved as a template: {title}", { title: r.title }) : t("Made as a new app: {title}", { title: r.title });
  } catch (e) {
    msg = said(e);
  }
  return back(msg);
}
