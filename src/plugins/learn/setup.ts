/**
 * Learn is an external plugin (src/plugins/learn/bundled) built on Zeff's own layers: databases, one app view, flows and server
 * functions in a package. This is what makes it Zeff's Learn: the plugin's files are put into the plugins folder, the plugin switched on,
 * its package installed, what it asks for given, and what the old Learn had kept brought over. Each step is told to the person first
 * (the /learn page) and done on one click; nothing here runs by itself. Server only.
 */
import fs from "node:fs";
import path from "node:path";
import { getPlugin, pluginsRoot, scanPlugins, setEnabled } from "@/lib/ext/registry";
import { isInstalled, setInstalled } from "@/plugins/state";

export const LEARN_PLUGIN = "learn-ext";
const BUNDLED = path.join(/*turbopackIgnore: true*/ process.cwd(), "src", "plugins", "learn", "bundled");

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

const bundledVersion = (): string => {
  try {
    return String((JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ path.join(BUNDLED, "zeff-plugin.json"), "utf8")) as { version?: string }).version ?? "0.0.0");
  } catch {
    return "0.0.0";
  }
};

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
    updateAvailable: !!inst && !!offered?.version && life.compareVersions(offered.version, inst.version) > 0,
    rootId: inst?.rootId ?? null,
    coursesId: inst?.map.i2 ?? null,
    legacyToImport: !!inst && hasLegacyLearn() && !legacyDone(),
    ready: false,
  };
  s.ready = s.notebookPlugin && s.codeRuns && s.pluginOn && !!inst && !s.updateAvailable;
  return s;
}

/** The plugin's files into the plugins folder — when they are not there, or the bundled ones are newer. */
function copyPlugin(): string | null {
  const dest = path.join(/*turbopackIgnore: true*/ pluginsRoot(), LEARN_PLUGIN);
  let have = "";
  try {
    have = String((JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ path.join(dest, "zeff-plugin.json"), "utf8")) as { version?: string }).version ?? "");
  } catch {
    // not there yet
  }
  if (have && bundledVersion() === have) return null;
  fs.mkdirSync(/*turbopackIgnore: true*/ pluginsRoot(), { recursive: true });
  // (A function changed here — by you or the AI, its versions kept in .versions/ — stays as it is: a newer Learn doesn't take it back.)
  const changedHere = (file: string) => fs.existsSync(/*turbopackIgnore: true*/ path.join(dest, ".versions", path.relative(BUNDLED, file).split(path.sep).join("_")));
  fs.cpSync(/*turbopackIgnore: true*/ BUNDLED, dest, { recursive: true, filter: (src) => !changedHere(src) });
  return have ? `plugin files updated (${have} → ${bundledVersion()})` : "plugin files put into the plugins folder";
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
  const copied = copyPlugin();
  if (copied) done.push(copied);
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
