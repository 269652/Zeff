import fs from "node:fs";
import path from "node:path";
import { getPref, setPref } from "@/lib/prefs";
import * as git from "./git";
import { parseManifest, type Manifest } from "./manifest";
import { allPending, applyPlan, dropPending, openConflicts, pending, planFile, savePending, type FilePlan, type PendingMerge } from "./merge3";
import { readPackagesFile } from "./packages-file";
import { isEnabled, pluginsRoot, scanPlugins } from "./registry";

/**
 * Where plugins and apps come from, and newer versions of them: repositories — on GitHub (read through its web API), or any git
 * repository (a folder on this computer such as ../zeff-plugins, file://, ssh, another host — read with git). One repository may hold
 * many — every folder in it with a zeff-plugin.json is one, with its own version. The sources are the ones added here, the ones
 * packages.json names (packages-file.ts) and the repositories installed plugins name in their manifest.
 *
 * An update is merged the way git merges (merge3.ts): what the repository changed since the version installed and what was changed here
 * are put together file by file; where both changed the same lines, the update waits for the person to settle the conflicts (keep mine,
 * take theirs, the AI's merge, their own text) and nothing is written until then. A plugin installed from a source starts switched off,
 * and permissions an update adds are held back until it is switched on again (registry.ts). A private repository needs a token, which the
 * user enters. Server only.
 */

const SOURCES = "ext.sources";
const ORIGIN_PREF = (id: string) => `ext.origin:${id}`;
const MAX_FILES = 400;
const MAX_BYTES = 15_000_000;
const MAX_FILE = 5_000_000;
const CACHE_MS = 10 * 60_000;

export type Source = { id: string; url: string; branch?: string; token?: string; addedAt: string };
/** What the user sees of a source (never its token). */
export type SourceView = { id: string; url: string; branch?: string; hasToken: boolean; fromManifest?: boolean; fromPackages?: string; git?: boolean };
export type Origin = { url: string; path: string; branch: string; sha: string; version: string; at: string; files: string[] };
export type Remote = {
  id: string;
  name: string;
  version: string;
  description: string;
  path: string;
  manifest: Manifest;
  /** Commits since the one it was installed at changed its folder (asked only when the version stayed the same). */
  touched?: boolean;
};
export type RemoteState = Remote & { installed: string | null; fromHere: boolean; updateAvailable: boolean; enabled: boolean; conflicts: number };
export type SourceState = { source: SourceView; branch: string; sha: string; plugins: RemoteState[]; problems: string[]; error?: string; checkedAt: string };

// ---------------------------------------------------------------------------
// Fetching (one place: tests put a stand-in for GitHub here)
// ---------------------------------------------------------------------------

type Fetcher = (url: string, init?: { headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown>; arrayBuffer: () => Promise<ArrayBuffer> }>;
const g = globalThis as { __zeffSourceFetch?: Fetcher; __zeffSourceCache?: Map<string, { at: number; state: SourceState }> };
const fetcher = (): Fetcher => g.__zeffSourceFetch ?? ((url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(30_000) }) as never);
/** (Tests: a stand-in for the network.) */
export const setSourceFetcher = (f: Fetcher | undefined) => ((g.__zeffSourceFetch = f), cache().clear());
const cache = () => (g.__zeffSourceCache ??= new Map());

export function parseGithub(url: string): { owner: string; repo: string } | null {
  const m = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(String(url).trim());
  return m ? { owner: m[1], repo: m[2] } : null;
}

const headers = (token?: string): Record<string, string> => ({ Accept: "application/vnd.github+json", "User-Agent": "Zeff", ...(token ? { Authorization: `Bearer ${token}` } : {}) });

async function getJson(url: string, token?: string): Promise<unknown> {
  const r = await fetcher()(url, { headers: headers(token) });
  if (r.status === 404) throw new Error("Not found — is the address right? A private repository needs a token.");
  if (r.status === 401 || r.status === 403) throw new Error(`GitHub refused (${r.status}) — the token is wrong, or the rate limit is reached (a token raises it).`);
  if (!r.ok) throw new Error(`GitHub answered ${r.status}.`);
  return r.json();
}

type Tree = { sha: string; branch: string; files: { path: string; size: number }[] };
type Note = { sha: string; subject: string; at: string; author: string };
/** How a repository is read: its newest commit's files, one file of any commit, what changed between two commits. */
type Backend = { tree(): Promise<Tree>; file(sha: string, file: string): Promise<Buffer | null>; notes(from: string | null, to: string, under: string): Promise<Note[]> };

function githubBackend(s: Source): Backend {
  const o = parseGithub(s.url);
  if (!o) throw new Error("Not a repository address (https://github.com/owner/repo, a git address, or a folder).");
  return {
    async tree() {
      const branch = s.branch || String(((await getJson(`https://api.github.com/repos/${o.owner}/${o.repo}`, s.token)) as { default_branch?: string }).default_branch || "main");
      const commit = (await getJson(`https://api.github.com/repos/${o.owner}/${o.repo}/commits/${encodeURIComponent(branch)}`, s.token)) as { sha?: string };
      if (!commit.sha) throw new Error(`No branch “${branch}”.`);
      const tree = (await getJson(`https://api.github.com/repos/${o.owner}/${o.repo}/git/trees/${commit.sha}?recursive=1`, s.token)) as { tree?: { path: string; type: string; size?: number }[] };
      return { sha: commit.sha, branch, files: (tree.tree ?? []).filter((e) => e.type === "blob").map((e) => ({ path: e.path, size: e.size ?? 0 })) };
    },
    async file(sha, file) {
      // (raw.githubusercontent.com serves a file of a commit; with a token, a private repository's too)
      const r = await fetcher()(`https://raw.githubusercontent.com/${o.owner}/${o.repo}/${sha}/${file.split("/").map(encodeURIComponent).join("/")}`, { headers: s.token ? { Authorization: `Bearer ${s.token}`, "User-Agent": "Zeff" } : { "User-Agent": "Zeff" } });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`Could not read ${file} (${r.status}).`);
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > MAX_FILE) throw new Error(`${file} is too large.`);
      return buf;
    },
    async notes(from, to) {
      if (!from) return [];
      try {
        const c = (await getJson(`https://api.github.com/repos/${o.owner}/${o.repo}/compare/${from}...${to}`, s.token)) as { commits?: { sha: string; commit: { message: string; author?: { date?: string; name?: string } } }[] };
        return (c.commits ?? []).reverse().slice(0, 30).map((x) => ({ sha: x.sha, subject: x.commit.message.split("\n")[0], at: x.commit.author?.date ?? "", author: x.commit.author?.name ?? "" }));
      } catch {
        return [];
      }
    },
  };
}

function gitBackend(s: Source): Backend {
  let repo: Promise<{ dir: string; branch: string; sha: string }> | null = null;
  const fetched = () => (repo ??= git.fetchRepo(pluginsRoot(), s.url, s.branch, s.token));
  return {
    async tree() {
      const r = await fetched();
      return { sha: r.sha, branch: r.branch, files: await git.listFiles(r.dir, r.sha) };
    },
    async file(sha, file) {
      const buf = await git.readFile(git.mirrorDir(pluginsRoot(), s.url), sha, file);
      if (buf && buf.length > MAX_FILE) throw new Error(`${file} is too large.`);
      return buf;
    },
    notes: (from, to, under) => git.commitsBetween(git.mirrorDir(pluginsRoot(), s.url), from, to, under),
  };
}

const backendFor = (s: Source): Backend => (git.isGitUrl(s.url) ? gitBackend(s) : githubBackend(s));

// ---------------------------------------------------------------------------
// The sources
// ---------------------------------------------------------------------------

const stored = (): Source[] => getPref<Source[]>(SOURCES, []);
const norm = (url: string) => url.trim().toLowerCase().replace(/[\\/]+$/, "");

/** Where an installed plugin came from — kept beside the plugins (shared by every account); an older Zeff kept it in the account. */
export function origin(pluginId: string): Origin | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(pluginsRoot(), ".origin", `${pluginId}.json`), "utf8")) as Origin;
  } catch {
    return getPref<Origin | null>(ORIGIN_PREF(pluginId), null);
  }
}
function setOrigin(pluginId: string, o: Origin): void {
  fs.mkdirSync(path.join(pluginsRoot(), ".origin"), { recursive: true });
  fs.writeFileSync(path.join(pluginsRoot(), ".origin", `${pluginId}.json`), JSON.stringify(o, null, 1));
}

/** The sources: those you added, those packages.json names, and the repositories installed plugins name in their manifest. */
export function listSources(): Source[] {
  const own = stored();
  const seen = new Set(own.map((s) => norm(s.url)));
  const out = [...own];
  const pf = readPackagesFile();
  if (pf && "file" in pf)
    for (const [name, s] of Object.entries(pf.file.sources)) {
      if (seen.has(norm(s.url))) continue;
      seen.add(norm(s.url));
      // (a token for it: the one entered for the same address)
      const token = getPref<Record<string, string>>(`${SOURCES}.tokens`, {})[norm(s.url)];
      out.push({ id: `p:${name}`, url: s.url, ...(s.branch ? { branch: s.branch } : {}), ...(token ? { token } : {}), addedAt: "" });
    }
  for (const p of scanPlugins().plugins) {
    const r = p.manifest.repository;
    if (!r?.url || seen.has(norm(r.url))) continue;
    seen.add(norm(r.url));
    out.push({ id: `m:${p.id}`, url: r.url, ...(r.branch ? { branch: r.branch } : {}), addedAt: "" });
  }
  return out;
}

export const viewOf = (s: Source): SourceView => ({
  id: s.id,
  url: s.url,
  ...(s.branch ? { branch: s.branch } : {}),
  hasToken: !!s.token,
  ...(s.id.startsWith("m:") ? { fromManifest: true } : {}),
  ...(s.id.startsWith("p:") ? { fromPackages: s.id.slice(2) } : {}),
  ...(git.isGitUrl(s.url) ? { git: true } : {}),
});

/** A repository added as a source: on GitHub, any git address, or a folder on this computer. */
export function addSource(url: string, branch?: string, token?: string): Source {
  const raw = String(url ?? "").trim();
  const o = parseGithub(raw);
  if (!o && !git.isGitUrl(raw)) throw new Error("Not a repository address (https://github.com/owner/repo, a git address, or a folder).");
  if (branch && !/^[\w./-]{1,100}$/.test(branch)) throw new Error("That is no branch name.");
  const clean = o ? `https://github.com/${o.owner}/${o.repo}` : raw.replace(/[\\/]+$/, "");
  const all = stored();
  if (listSources().some((s) => norm(s.url) === norm(clean))) throw new Error("That repository is a source already.");
  const s: Source = { id: `s${Date.now().toString(36)}`, url: clean, ...(branch ? { branch } : {}), ...(token?.trim() ? { token: token.trim() } : {}), addedAt: new Date().toISOString() };
  setPref(SOURCES, [...all, s].slice(0, 30));
  return s;
}

/** A token for a source packages.json names (kept in Zeff, never in the file). */
export function setSourceToken(url: string, token: string): void {
  const all = getPref<Record<string, string>>(`${SOURCES}.tokens`, {});
  if (token.trim()) all[norm(url)] = token.trim();
  else delete all[norm(url)];
  setPref(`${SOURCES}.tokens`, all);
  cache().clear();
}

export function removeSource(id: string): void {
  setPref(SOURCES, stored().filter((s) => s.id !== id));
  cache().delete(id);
}

export const sourceById = (id: string): Source => {
  const s = listSources().find((x) => x.id === id);
  if (!s) throw new Error("There is no such source.");
  return s;
};
/** The source with this address (added, or from packages.json). */
export const sourceByUrl = (url: string): Source | undefined => listSources().find((s) => norm(s.url) === norm(url));

// ---------------------------------------------------------------------------
// What a source has, and how it stands against what is installed
// ---------------------------------------------------------------------------

export const compareVersions = (a: string, b: string): number => {
  const pa = a.split(/[.+-]/).map((x) => Number(x) || 0);
  const pb = b.split(/[.+-]/).map((x) => Number(x) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
};

/** The plugins in a source (each folder with a zeff-plugin.json, up to 4 levels deep), against what is installed. Cached 10 minutes. */
export async function checkSource(id: string, opts: { fresh?: boolean } = {}): Promise<SourceState> {
  const s = sourceById(id);
  const hit = cache().get(id);
  if (!opts.fresh && hit && Date.now() - hit.at < CACHE_MS) return withInstalled(hit.state);
  let state: SourceState;
  try {
    const b = backendFor(s);
    const tree = await b.tree();
    const manifests = tree.files.filter((f) => /(^|\/)zeff-plugin\.json$/.test(f.path) && f.path.split("/").length <= 5).slice(0, 80);
    const plugins: Remote[] = [];
    const problems: string[] = [];
    for (const m of manifests) {
      const dir = m.path.replace(/\/?zeff-plugin\.json$/, "");
      try {
        const buf = await b.file(tree.sha, m.path);
        const r = parseManifest((buf ?? Buffer.from("")).toString("utf8"));
        if (!r.ok) problems.push(`${dir || "(top)"}: ${r.error}`);
        else plugins.push({ id: r.manifest.id, name: r.manifest.name, version: r.manifest.version, description: r.manifest.description, path: dir, manifest: r.manifest });
      } catch (e) {
        problems.push(`${dir || "(top)"}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    // The same version at another commit is an update only when a commit since changed the plugin's own folder (a commit to another
    // plugin of the repository is not one for this).
    for (const p of plugins) {
      const from = origin(p.id);
      if (from && norm(from.url) === norm(s.url) && from.path === p.path && from.sha && from.sha !== tree.sha && compareVersions(p.version, from.version) === 0)
        p.touched = (await b.notes(from.sha, tree.sha, p.path).catch(() => [{}])).length > 0;
    }
    state = { source: viewOf(s), branch: tree.branch, sha: tree.sha, plugins: plugins.map((p) => ({ ...p, installed: null, fromHere: false, updateAvailable: false, enabled: false, conflicts: 0 })), problems, checkedAt: new Date().toISOString() };
  } catch (e) {
    state = { source: viewOf(s), branch: s.branch ?? "", sha: "", plugins: [], problems: [], error: e instanceof Error ? e.message : String(e), checkedAt: new Date().toISOString() };
  }
  cache().set(id, { at: Date.now(), state });
  return withInstalled(state);
}

function withInstalled(state: SourceState): SourceState {
  const here = new Map(scanPlugins().plugins.map((p) => [p.id, p]));
  return {
    ...state,
    plugins: state.plugins.map((p) => {
      const inst = here.get(p.id);
      const from = origin(p.id);
      const fromHere = !!from && norm(from.url) === norm(state.source.url);
      const waiting = pending(pluginsRoot(), p.id);
      return {
        ...p,
        installed: inst?.manifest.version ?? null,
        fromHere,
        // (newer — or the same version with other commits, when it came from here: a change published without a new version number)
        updateAvailable: !!inst && (compareVersions(p.version, inst.manifest.version) > 0 || (fromHere && !!from && from.path === p.path && from.sha !== state.sha && compareVersions(p.version, inst.manifest.version) === 0 && !!state.sha && p.touched === true)),
        enabled: !!inst && isEnabled(p.id),
        conflicts: waiting ? openConflicts(waiting).length : 0,
      };
    }),
  };
}

/** Every source checked (each cached): what can be updated, in all. */
export async function checkAll(opts: { fresh?: boolean } = {}): Promise<SourceState[]> {
  return Promise.all(listSources().map((s) => checkSource(s.id, opts)));
}

/** What an update brings: the commits since the version installed that touched the plugin's folder (newest first). */
export async function updateNotes(sourceId: string, pluginId: string): Promise<Note[]> {
  const s = sourceById(sourceId);
  const st = await checkSource(sourceId);
  const p = st.plugins.find((x) => x.id === pluginId);
  if (!p || !st.sha) return [];
  const from = origin(pluginId);
  return backendFor(s).notes(from && norm(from.url) === norm(s.url) ? from.sha : null, st.sha, p.path);
}

// ---------------------------------------------------------------------------
// Install / update one folder — merged with what was changed here
// ---------------------------------------------------------------------------

const safeRel = (rel: string): boolean => !!rel && !rel.split("/").some((x) => x === ".." || x === "" || x.startsWith(".")) && !path.isAbsolute(rel);

export type InstallReport = {
  id: string;
  from: string | null;
  to: string;
  files: number;
  /** Changed here and kept (the update didn't touch them, or both sides were merged). */
  kept: string[];
  /** Merged: changed on both sides without a conflict. */
  merged: string[];
  /** Conflicts waiting for the person — then nothing was written yet. */
  conflicts: string[];
  app?: { from: string; to: string; changes: number; kept: number } | null;
};

/** The files of the plugin's folder here, by their path in it (none of the dot folders: .versions, .git …). */
function localFiles(dest: string): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  const walk = (dir: string, rel: string) => {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), r);
      else if (e.isFile()) out.set(r, fs.readFileSync(path.join(dir, e.name)));
    }
  };
  walk(dest, "");
  return out;
}

/**
 * A plugin of a source installed or brought to the source's version, merged with what was changed here: its folder's files at the newest
 * commit (theirs), at the commit installed before (base — when it came from this source) and in the plugins folder (mine), file by file
 * (merge3.ts). Without a conflict the result is written at once — files the old version brought and the new one doesn't go, files made
 * here stay; with conflicts the update waits (pendingMerge) and nothing changes until they are settled (finishMerge). Then its app (a
 * package it brings), when installed and the plugin is on, is updated in place (what you changed there stays).
 */
export async function installFromSource(sourceId: string, pluginId: string): Promise<InstallReport> {
  const s = sourceById(sourceId);
  const b = backendFor(s);
  const state = await checkSource(sourceId, { fresh: true });
  if (state.error) throw new Error(state.error);
  const remote = state.plugins.find((p) => p.id === pluginId);
  if (!remote) throw new Error(`The source has no plugin “${pluginId}”.`);
  const tree = await b.tree();
  const prefix = remote.path ? `${remote.path}/` : "";
  const files = tree.files.filter((f) => f.path.startsWith(prefix) && safeRel(f.path.slice(prefix.length)));
  if (files.length > MAX_FILES) throw new Error(`The folder has too many files (${files.length}).`);
  if (files.reduce((a, f) => a + f.size, 0) > MAX_BYTES) throw new Error("The folder is too large.");
  const dest = path.join(pluginsRoot(), pluginId);
  const had = scanPlugins(true).plugins.find((p) => p.id === pluginId);
  const before = origin(pluginId);

  // Theirs: fetched first, all of them — a folder half written is worse than none.
  const theirs = new Map<string, Buffer>();
  for (const f of files) theirs.set(f.path.slice(prefix.length), (await b.file(tree.sha, f.path)) ?? Buffer.from(""));
  const man = theirs.get("zeff-plugin.json");
  const parsed = man ? parseManifest(man.toString("utf8")) : null;
  if (!parsed?.ok) throw new Error(`Its zeff-plugin.json doesn't hold: ${parsed && !parsed.ok ? parsed.error : "missing"}`);
  if (parsed.manifest.id !== pluginId) throw new Error("The plugin's id changed in the source.");

  // Base: the version installed before — read where it came from (this source, or the one it came from before it moved: packages.json
  // naming another repository); none when that isn't known — then every difference is a conflict.
  const sameOrigin = !!before && norm(before.url) === norm(s.url) && before.path === remote.path && !!before.sha;
  const oldSource = before?.sha && !sameOrigin ? sourceByUrl(before.url) : undefined;
  const baseBackend = sameOrigin ? b : oldSource ? backendFor(oldSource) : null;
  const basePrefix = before?.path ? `${before.path}/` : "";
  const mine = localFiles(dest);
  const rels = new Set<string>([...theirs.keys(), ...(before?.files ?? [])]);
  const plans: FilePlan[] = [];
  for (const rel of [...rels].sort()) {
    if (!safeRel(rel)) continue;
    const base = baseBackend && before?.sha ? await baseBackend.file(before.sha, `${basePrefix}${rel}`).catch(() => null) : null;
    // (a file made here that the plugin never had and the update doesn't bring: not part of the merge — it stays)
    plans.push(await planFile(rel, base, mine.get(rel) ?? null, theirs.get(rel) ?? null));
  }
  const to: PendingMerge["to"] = { url: s.url, path: remote.path, branch: tree.branch, sha: tree.sha, version: parsed.manifest.version, files: [...theirs.keys()] };
  const conflicts = plans.filter((p) => p.outcome === "conflict");
  const report: InstallReport = {
    id: pluginId,
    from: had?.manifest.version ?? null,
    to: parsed.manifest.version,
    files: plans.filter((p) => p.outcome === "take" || p.outcome === "add" || p.outcome === "merged").length,
    kept: plans.filter((p) => p.outcome === "keep" && mine.has(p.rel) && theirs.has(p.rel) && !mine.get(p.rel)!.equals(theirs.get(p.rel)!)).map((p) => p.rel),
    merged: plans.filter((p) => p.outcome === "merged").map((p) => p.rel),
    conflicts: conflicts.map((p) => p.rel),
  };
  if (conflicts.length) {
    savePending(pluginsRoot(), { pluginId, to, from: { version: had?.manifest.version ?? null, sha: before?.sha ?? null }, files: plans, at: new Date().toISOString() });
    return report;
  }
  dropPending(pluginsRoot(), pluginId);
  report.app = await finish(pluginId, dest, plans, to, sourceId);
  return report;
}

/** The plan written, the origin kept, its app updated. */
async function finish(pluginId: string, dest: string, plans: FilePlan[], to: PendingMerge["to"], sourceId?: string): Promise<InstallReport["app"]> {
  fs.mkdirSync(dest, { recursive: true });
  applyPlan(dest, plans);
  setOrigin(pluginId, { url: to.url, path: to.path, branch: to.branch, sha: to.sha, version: to.version, at: new Date().toISOString(), files: to.files });
  scanPlugins(true);
  if (sourceId) cache().delete(sourceId);
  else cache().clear();
  // Its app, brought up to date the usual way (only when it is installed and the plugin is on — its package is offered then).
  try {
    const life = await import("@/plugins/workspace/package-life");
    const inst = life.getInstalled(pluginId);
    const offered = inst ? await life.offeredPackage(pluginId) : null;
    if (inst && offered?.version && life.compareVersions(offered.version, inst.version) > 0) {
      const r = await life.updateTracked(pluginId, offered);
      return { from: r.from, to: r.to, changes: r.changes.length, kept: r.kept.length };
    }
  } catch {
    // (no workspace: no app to update)
  }
  return null;
}

/** An update waiting for its conflicts to be settled (null: none). */
export const pendingMerge = (pluginId: string): PendingMerge | null => pending(pluginsRoot(), pluginId);
export const pendingMerges = (): PendingMerge[] => allPending(pluginsRoot());

/** One conflict settled (mine / theirs / the AI's text / the person's text). */
export async function settleConflict(pluginId: string, rel: string, how: "mine" | "theirs" | "ai" | "edited", content?: string | null): Promise<PendingMerge> {
  const m = pendingMerge(pluginId);
  if (!m) throw new Error("No update is waiting for this plugin.");
  const { resolve } = await import("./merge3");
  m.files = m.files.map((f) => (f.rel === rel ? resolve(f, how, content) : f));
  savePending(pluginsRoot(), m);
  return m;
}

/** The waiting update written, once no conflict is open. */
export async function finishMerge(pluginId: string): Promise<InstallReport> {
  const m = pendingMerge(pluginId);
  if (!m) throw new Error("No update is waiting for this plugin.");
  const open = openConflicts(m);
  if (open.length) throw new Error(`Still open: ${open.map((f) => f.rel).join(", ")}.`);
  const app = await finish(pluginId, path.join(pluginsRoot(), pluginId), m.files, m.to);
  dropPending(pluginsRoot(), pluginId);
  return { id: pluginId, from: m.from.version, to: m.to.version, files: m.files.filter((f) => f.result !== undefined && f.outcome !== "keep").length, kept: [], merged: m.files.filter((f) => f.outcome === "merged" || f.resolved).map((f) => f.rel), conflicts: [], app };
}

/** The waiting update dropped: the plugin stays as it is. */
export const cancelMerge = (pluginId: string): void => dropPending(pluginsRoot(), pluginId);

/** Every plugin of every source that has a newer version, updated (installed ones only; one with conflicts waits). */
export async function updateAll(): Promise<InstallReport[]> {
  const out: InstallReport[] = [];
  for (const st of await checkAll({ fresh: true })) for (const p of st.plugins) if (p.updateAvailable && p.fromHere) out.push(await installFromSource(st.source.id, p.id));
  return out;
}
