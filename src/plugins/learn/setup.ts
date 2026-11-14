/**
 * Learn is an external plugin (in the zeff-plugins repository: plugins/learn) built on Zeff's own layers: databases, one app view, flows
 * and server functions in a package. This is what makes it Zeff's Learn: the plugin installed from that repository, switched on,
 * its package installed, what it asks for given, and what the old Learn had kept brought over. Each step is told to the person first
 * (the /learn page) and done on one click; nothing here runs by itself. Server only.
 */
import fs from "node:fs";
import path from "node:path";
import { getPlugin, pluginsRoot, scanPlugins, setEnabled } from "@/lib/ext/registry";
import { isInstalled, setInstalled } from "@/plugins/state";

export const LEARN_PLUGIN = "learn-ext";

export type LearnStatus = {
  /** The Notebook plugin (it runs the plugin's functions) is installed, and running code is switched on. */
  notebookPlugin: boolean;
  codeRuns: boolean;
  pluginOn: boolean;
  packageVersion: string | null;
  /** The package has a newer version (the plugin was updated). */
  updateAvailable: boolean;
  /** The Learn page and its Courses database, once installed. */
  rootId: number | null;
  coursesId: number | null;
  /** The old Learn's data is there and not brought over yet. */
  legacyToImport: boolean;
  ready: boolean;
};

/** The version of Learn's app (its package) in the plugins folder ("": not there). */
const packageVersion = (): string => {
  try {
    return String((JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ path.join(pluginsRoot(), LEARN_PLUGIN, "learn.package.json"), "utf8")) as { version?: string }).version ?? "");
  } catch {
    return "";
  }
};

/**
 * A newer Learn is in the plugins folder (its files came from the zeff-plugins repository, newer than the app installed) — what the note
 * in its views offers to bring in. Cheap (two small files read). null when Learn is not set up yet (its own page says what to do) or up to
 * date. (A newer version in the repository itself is the app's update note — packages-sync.ts.)
 */
export async function learnUpdate(): Promise<{ from: string; to: string } | null> {
  if (!isInstalled("learn")) return null;
  const { getInstalled } = await import("@/plugins/workspace/package-registry");
  const inst = getInstalled(LEARN_PLUGIN);
  if (!inst) return null;
  const { compareVersions } = await import("@/plugins/workspace/semver");
  // (the app's version is its package's — the plugin's own version moves too when only its files or texts change)
  const to = packageVersion();
  if (!to || compareVersions(to, inst.version) <= 0) return null;
  return { from: inst.version, to };
}

export async function learnStatus(): Promise<LearnStatus> {
  const life = await import("@/plugins/workspace/package-life");
  const { notebookEnabled } = await import("@/plugins/notebook/runtimes");
  const inst = life.getInstalled(LEARN_PLUGIN);
  const offered = await life.offeredPackage(LEARN_PLUGIN);
  const { hasLegacyLearn, legacyDone } = await import("./legacy-import");
  const s: LearnStatus = {
    notebookPlugin: isInstalled("notebook"),
    codeRuns: notebookEnabled(),
    pluginOn: !!getPlugin(LEARN_PLUGIN)?.enabled,
    packageVersion: inst?.version ?? null,
    // (Newer in the plugins folder, or newer in the files that came with Zeff and not copied there yet.)
    updateAvailable: !!inst && !!offered?.version && life.compareVersions(offered.version, inst.version) > 0,
    rootId: inst?.rootId ?? null,
    coursesId: inst?.map.i2 ?? null,
    legacyToImport: !!inst && hasLegacyLearn() && !legacyDone(),
    ready: false,
  };
  s.ready = s.notebookPlugin && s.codeRuns && s.pluginOn && !!inst && !s.updateAvailable;
  return s;
}

/**
 * The plugin's files in the plugins folder: when they aren't there yet, installed from the repository that has Learn (packages.json names
 * zeff-plugins; or a source added under Plugins → Sources) and written into packages.json. Newer versions come as the app's update notes,
 * merged with what was changed here (sources.ts).
 */
async function ensurePlugin(): Promise<string | null> {
  if (scanPlugins(true).plugins.some((p) => p.id === LEARN_PLUGIN)) return null;
  const src = await import("@/lib/ext/sources");
  for (const st of await src.checkAll({ fresh: true })) {
    if (!st.plugins.some((p) => p.id === LEARN_PLUGIN)) continue;
    const r = await src.installFromSource(st.source.id, LEARN_PLUGIN);
    if (r.conflicts.length) throw new Error(`Learn's files differ from what is in the plugins folder (${r.conflicts.join(", ")}) — settle it in the update note.`);
    (await import("@/lib/ext/packages-sync")).rememberInPackages(LEARN_PLUGIN);
    return `plugin ${r.to} installed from ${st.source.url}`;
  }
  throw new Error("Learn comes from the zeff-plugins repository — name it in packages.json (or add it under Plugins → Sources).");
}

/**
 * Everything Learn needs, on one click: the Notebook plugin installed and code running switched on (the plugin's functions run in it),
 * the plugin switched on, its package installed (or brought to the newest version) with the permissions its flows ask for, its functions
 * allowed what they need, the old Learn's data brought over. Returns what was done, in words.
 */
export async function setupLearn(): Promise<string[]> {
  const done: string[] = [];
  if (!isInstalled("notebook")) {
    setInstalled("notebook", true);
    done.push("Notebook plugin installed");
  }
  const rt = await import("@/plugins/notebook/runtimes");
  if (!rt.notebookEnabled()) {
    rt.setNotebookEnabled(true);
    done.push("running code switched on (Settings → Notebook)");
  }
  const installed = await ensurePlugin();
  if (installed) done.push(installed);
  scanPlugins(true);
  if (!getPlugin(LEARN_PLUGIN)?.enabled) {
    setEnabled(LEARN_PLUGIN, true);
    done.push("plugin switched on");
  }
  const life = await import("@/plugins/workspace/package-life");
  const pkg = await life.offeredPackage(LEARN_PLUGIN);
  if (!pkg) throw new Error("The Learn package is not on offer (the plugin could not be read).");
  if (!life.getInstalled(LEARN_PLUGIN)) {
    const r = await life.installTracked(pkg, null, { allow: true });
    done.push(`package installed${r.allowed.length ? `, its ${r.allowed.length} flows allowed what they ask` : ""}`);
  } else if (life.compareVersions(pkg.version ?? "0.0.0", life.getInstalled(LEARN_PLUGIN)!.version) > 0) {
    // (The flows of the newer version get what they ask for too: the person said so by setting Learn up.)
    const r = await life.updateTracked(LEARN_PLUGIN, pkg, { allow: true });
    done.push(`package updated ${r.from} → ${r.to}`);
  }
  const { declaredFunctions } = await import("@/plugins/notebook/functions");
  const { grantNeeds } = await import("@/plugins/notebook/grants");
  grantNeeds(LEARN_PLUGIN, declaredFunctions().filter((f) => f.plugin === LEARN_PLUGIN).flatMap((f) => f.needs));
  done.push("its functions allowed what they need");
  const { hasLegacyLearn, legacyDone, importLegacyLearn } = await import("./legacy-import");
  if (hasLegacyLearn() && !legacyDone()) {
    const n = importLegacyLearn();
    done.push(`brought over from the old Learn: ${n.courses} courses, ${n.steps} steps, ${n.exercises} exercises, ${n.cards} cards, ${n.messages} messages, ${n.activity} activities`);
  }
  return done;
}
