"use server";

import { run } from "./shared";

// ---------------------------------------------------------------------------
// Versions of an app's parts, for the "History" buttons: a flow, a database's fields, a routine, a form (part-versions.ts), a view's
// template (store.ts) and a plugin's function (notebook/function-source.ts). Each lists its versions, shows one, brings one back.
// ---------------------------------------------------------------------------

export type HistoryItem = { id: string; at: string; by: string; size: number };

export async function partVersionsAction(kind: string, ref: number) {
  return run(async () => {
    const pv = await import("../part-versions");
    if (!pv.isPartKind(kind)) throw new Error("No such kind of part.");
    return { versions: pv.partVersions(kind, Number(ref)).map((v): HistoryItem => ({ id: String(v.id), at: v.at, by: v.by, size: v.size })) };
  });
}

export async function partVersionAction(id: string) {
  return run(async () => {
    const v = (await import("../part-versions")).partVersion(Number(id));
    if (!v) throw new Error("There is no such version.");
    return { text: JSON.stringify(v.body, null, 2) };
  });
}

export async function restorePartAction(id: string) {
  return run(async () => ({ restored: await (await import("../part-restore")).restorePart(Number(id)) }));
}

export async function viewVersionsAction(dbId: number, viewId: string) {
  return run(async () => ({ versions: (await import("../store")).viewVersions(Number(dbId), String(viewId)).map((v): HistoryItem => ({ id: String(v.id), at: v.at, by: v.by, size: v.size })) }));
}

export async function viewVersionAction(id: string) {
  return run(async () => {
    const v = (await import("../store")).viewVersion(Number(id));
    if (!v) throw new Error("There is no such version.");
    return { text: v.template };
  });
}

export async function restoreViewVersionAction(id: string) {
  return run(async () => {
    (await import("../store")).restoreViewVersion(Number(id));
    return {};
  });
}

export async function functionVersionsAction(plugin: string, name: string) {
  return run(async () => ({ versions: (await import("@/plugins/notebook/function-source")).functionSource(String(plugin), String(name)).versions.map((v): HistoryItem => ({ id: v.id, at: v.at, by: "", size: v.size })) }));
}

export async function functionVersionAction(plugin: string, name: string, id: string) {
  return run(async () => ({ text: (await import("@/plugins/notebook/function-source")).functionVersionCode(String(plugin), String(name), String(id)) }));
}

export async function restoreFunctionVersionAction(plugin: string, name: string, id: string) {
  return run(async () => {
    (await import("@/plugins/notebook/function-source")).restoreFunctionSource(String(plugin), String(name), String(id));
    return {};
  });
}

// ---------------------------------------------------------------------------
// The whole app's history, on its top page: versions kept and save points (package-life.ts, app-savepoints.ts)
// ---------------------------------------------------------------------------

const appOf = async (pageId: number) => {
  const life = await import("../package-life");
  const app = life.appOfPage(Number(pageId));
  return { life, app };
};

/** The app whose top page this is, with its versions and save points (app: null — this page is no app's top page). */
export async function appHistoryAction(pageId: number) {
  return run(async () => {
    const { life, app } = await appOf(pageId);
    return { app: app ? life.appHistory(app.id) : null };
  });
}

export async function keepAppStateAction(pageId: number, label: string) {
  return run(async () => {
    const { life, app } = await appOf(pageId);
    if (!app) throw new Error("This page is no app's top page.");
    const sp = life.keepAppState(app.id, String(label ?? "").trim() || "Kept by hand");
    return { kept: !!sp };
  });
}

export async function restoreAppAction(pageId: number, what: { savePoint?: number; version?: string }) {
  return run(async () => {
    const { life, app } = await appOf(pageId);
    if (!app) throw new Error("This page is no app's top page.");
    const r = what.savePoint ? await life.restoreSavePoint(app.id, Number(what.savePoint)) : await life.rollbackTracked(app.id, String(what.version ?? ""));
    return { changes: r.changes.length };
  });
}

export async function appAsNewAction(pageId: number, what: { savePoint?: number; version?: string }, template: boolean) {
  return run(async () => {
    const { life, app } = await appOf(pageId);
    if (!app) throw new Error("This page is no app's top page.");
    const r = what.savePoint ? await life.savePointAsNew(app.id, Number(what.savePoint), { template: !!template }) : await life.snapshotAsNew(app.id, String(what.version ?? ""), { template: !!template });
    return r;
  });
}
