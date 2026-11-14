"use server";

import { revalidatePath } from "next/cache";
import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";

/**
 * Server Actions of the plugin sources (sources.ts): add / remove a repository, check it, install or update from it (merged with what was
 * changed here); the update notes and the conflicts an update waits for; packages.json followed (packages-sync.ts).
 */

type Res<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const done = () => revalidatePath("/plugins");

export async function addSourceAction(url: string, branch: string, token: string): Promise<Res> {
  try {
    (await import("./sources")).addSource(String(url ?? ""), String(branch ?? "").trim() || undefined, String(token ?? ""));
    done();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

export async function removeSourceAction(id: string): Promise<Res> {
  try {
    (await import("./sources")).removeSource(String(id));
    done();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

export async function checkSourcesAction(fresh = false): Promise<Res<{ states: import("./sources").SourceState[] }>> {
  try {
    const states = await (await import("./sources")).checkAll({ fresh: !!fresh });
    // (checked now: the update notes follow at once — not only at the half-hourly check)
    if (fresh) await (await import("./packages-sync")).checkForUpdates().catch(() => {});
    // (what goes to the page: no manifests in full)
    return { ok: true, states: states.map((s) => ({ ...s, plugins: s.plugins.map((p) => ({ ...p, manifest: { ...p.manifest, contributes: undefined } as never })) })) };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

/** What an install or update did, in a line. */
function told(r: import("./sources").InstallReport): string {
  if (r.conflicts.length === 1) return t("{id} {to}: a conflict with what you changed — settle it to finish the update", { id: r.id, to: r.to });
  if (r.conflicts.length) return t("{id} {to}: {n} conflicts with what you changed — settle them to finish the update", { id: r.id, to: r.to, n: r.conflicts.length });
  const what = r.from ? t("{id}: {from} → {to}", { id: r.id, from: r.from, to: r.to }) : t("{id} {to} installed — switch it on to use it", { id: r.id, to: r.to });
  const app = r.app ? ` · ${t("its app {from} → {to}", { from: r.app.from, to: r.app.to })}` : "";
  const merged = r.merged.length ? ` · ${t("merged with your changes: {files}", { files: r.merged.join(", ") })}` : "";
  const kept = r.kept.length ? ` · ${t("kept as you changed them: {files}", { files: r.kept.join(", ") })}` : "";
  return what + app + merged + kept;
}

export async function installFromSourceAction(sourceId: string, pluginId: string): Promise<Res<{ message: string; conflicts: string[] }>> {
  try {
    // A patch to Zeff itself ("mod:<id>"): only a signed release, built and loaded (lib/mods/feed.ts).
    if (String(pluginId).startsWith("mod:")) {
      const m = await (await import("./sources")).installModFromSource(String(sourceId), String(pluginId).slice(4));
      await (await import("./packages-sync")).checkForUpdates().catch(() => {});
      done();
      return { ok: true, message: `${m.id} ${m.from ? `${m.from} → ` : ""}${m.to}${m.problems.length ? ` — it didn't build: ${m.problems[0]}` : ""}`, conflicts: [] };
    }
    const r = await (await import("./sources")).installFromSource(String(sourceId), String(pluginId));
    const sync = await import("./packages-sync");
    // (packages.json says what this Zeff has: the plugin and where it came from)
    if (!r.conflicts.length) sync.rememberInPackages(r.id);
    await sync.checkForUpdates().catch(() => {});
    done();
    return { ok: true, message: told(r), conflicts: r.conflicts };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

export async function updateAllFromSourcesAction(): Promise<Res<{ message: string }>> {
  try {
    const r = await (await import("./sources")).updateAll();
    const sync = await import("./packages-sync");
    for (const x of r) if (!x.conflicts.length) sync.rememberInPackages(x.id);
    await sync.checkForUpdates().catch(() => {});
    done();
    return { ok: true, message: r.length ? r.map(told).join(" · ") : t("Everything is up to date.") };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

// ---------------------------------------------------------------------------
// Update notes, and an update that waits for its conflicts
// ---------------------------------------------------------------------------

export type UpdatesView = { updates: import("./packages-sync").UpdateNote[]; packages: import("./packages-sync").PackagesState | null };

/** The notes found at the last check (cheap: read from a file) — the app asks every few minutes. `fresh`: the sources checked now. */
export async function pluginUpdatesAction(fresh = false): Promise<Res<UpdatesView>> {
  try {
    const sync = await import("./packages-sync");
    if (fresh) await sync.checkForUpdates();
    return { ok: true, updates: sync.storedUpdates().updates, packages: sync.packagesState() };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

/** “Later”: this version isn't offered again. */
export async function putOffUpdateAction(id: string, version: string): Promise<Res> {
  try {
    (await import("./packages-sync")).putOff(String(id), String(version));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

export type MergeFileView = { rel: string; outcome: string; resolved?: string; binary?: boolean; base?: string | null; mine?: string | null; theirs?: string | null; markers?: string; result?: string | null };
export type MergeView = { pluginId: string; from: string | null; to: string; files: MergeFileView[] };

/** The update waiting for its conflicts (the conflicts with their three sides; the rest only named). */
export async function pendingMergeAction(pluginId: string): Promise<Res<{ merge: MergeView | null }>> {
  try {
    const m = (await import("./sources")).pendingMerge(String(pluginId));
    if (!m) return { ok: true, merge: null };
    const files: MergeFileView[] = m.files.map((f) =>
      f.outcome === "conflict"
        ? { rel: f.rel, outcome: f.outcome, resolved: f.resolved, binary: f.binary, base: f.base, mine: f.mine, theirs: f.theirs, markers: f.markers, result: f.result === undefined || f.result === null ? f.result : Buffer.from(f.result, "base64").toString("utf8") }
        : { rel: f.rel, outcome: f.outcome },
    );
    return { ok: true, merge: { pluginId: m.pluginId, from: m.from.version, to: m.to.version, files } };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

/** One conflict settled: keep mine, take theirs, or a text (the AI's, or the person's). */
export async function settleConflictAction(pluginId: string, rel: string, how: "mine" | "theirs" | "ai" | "edited", content?: string | null): Promise<Res> {
  try {
    if (!["mine", "theirs", "ai", "edited"].includes(how)) throw new Error("How?");
    await (await import("./sources")).settleConflict(String(pluginId), String(rel), how, content === undefined ? undefined : content === null ? null : String(content));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

/** The AI's merge of one conflict — a proposal for the editor, not saved. */
export async function aiMergeAction(pluginId: string, rel: string): Promise<Res<{ text: string; note: string }>> {
  try {
    const m = (await import("./sources")).pendingMerge(String(pluginId));
    const f = m?.files.find((x) => x.rel === rel && x.outcome === "conflict");
    if (!f) throw new Error("No such conflict.");
    if (f.binary) throw new Error(t("This file is not text — keep yours or take theirs."));
    return { ok: true, ...(await (await import("./merge-ai")).aiMerge(f.rel, f.base ?? null, f.mine ?? null, f.theirs ?? null)) };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

/** The waiting update written (no conflict left). */
export async function finishMergeAction(pluginId: string): Promise<Res<{ message: string }>> {
  try {
    const r = await (await import("./sources")).finishMerge(String(pluginId));
    const sync = await import("./packages-sync");
    sync.rememberInPackages(r.id);
    await sync.checkForUpdates().catch(() => {});
    done();
    return { ok: true, message: told(r) };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

/** The waiting update dropped: the plugin stays as it is. */
export async function cancelMergeAction(pluginId: string): Promise<Res> {
  try {
    (await import("./sources")).cancelMerge(String(pluginId));
    await (await import("./packages-sync")).checkForUpdates().catch(() => {});
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

/** packages.json followed now (also when it didn't change). */
export async function applyPackagesAction(): Promise<Res<{ state: import("./packages-sync").PackagesState | null }>> {
  try {
    const state = await (await import("./packages-sync")).applyPackagesFile({ force: true });
    done();
    return { ok: true, state };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}
