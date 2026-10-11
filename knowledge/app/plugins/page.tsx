import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { findClaudeCli } from "@/plugins/claude-cli/cli";
import { findCopilotCli } from "@/plugins/copilot-cli/cli";
import { confluenceWhere } from "@k/confluence";
import { defaultInstalled, installedKPlugins, isKPluginId, KCATEGORY_LABELS, KPLUGINS, kpluginById, setKInstalled, type KCategory, type KPlugin } from "@k/plugins";

/** Where a plugin stands on this machine: the CLI found, Confluence set up — in words. */
function found(p: KPlugin): string | null {
  if (p.id === "copilot-cli") return findCopilotCli()?.where ?? "not found";
  if (p.id === "claude-cli") return findClaudeCli() ?? "not found";
  if (p.id === "confluence") return confluenceWhere() ?? "not set up";
  return null;
}

/**
 * The knowledge server's plugins: its sources, its AI backends, reading by itself — each installed
 * or not, like Zeff's.
 */
export default async function PluginsPage({ searchParams }: { searchParams: Promise<{ done?: string; error?: string }> }) {
  await connection();
  const { done, error } = await searchParams;
  const on = installedKPlugins();

  async function toggle(fd: FormData) {
    "use server";
    const id = String(fd.get("id"));
    if (!isKPluginId(id)) return;
    const install = fd.get("install") === "1";
    try {
      setKInstalled(id, install);
    } catch (e) {
      redirect(`/plugins?error=${encodeURIComponent(e instanceof Error ? e.message : String(e))}`);
    }
    revalidatePath("/", "layout");
    redirect(`/plugins?done=${encodeURIComponent(`${kpluginById(id).name} ${install ? "installed" : "uninstalled"}.`)}`);
  }

  return (
    <>
      <div>
        <h1 className="text-lg font-semibold">Plugins</h1>
        <p className="max-w-[75ch] text-sm text-zinc-500">
          Where the knowledge comes from, which AI compiles it and answers, and whether the server reads by itself. An uninstalled plugin takes what it does along — the knowledge it brought stays. Which CLI does which task: <Link href="/" className="text-indigo-600 hover:underline dark:text-indigo-400">Settings</Link>.
        </p>
      </div>
      {done && <p className="alert-ok">{done}</p>}
      {error && <p className="alert-error">{error}</p>}
      {(Object.keys(KCATEGORY_LABELS) as KCategory[]).map((c) => (
        <section key={c} className="space-y-2">
          <h2 className="text-sm font-semibold text-zinc-500 uppercase">{KCATEGORY_LABELS[c]}</h2>
          <ul className="grid gap-3 md:grid-cols-2">
            {KPLUGINS.filter((p) => p.category === c).map((p) => {
              const installed = on.has(p.id);
              const where = found(p);
              return (
                <li key={p.id} className={`card space-y-2 p-4 ${installed ? "" : "opacity-80"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-medium">
                        {p.name}{" "}
                        {installed ? (
                          <span className="ml-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">installed</span>
                        ) : (
                          <span className="ml-1 rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">not installed</span>
                        )}
                        {defaultInstalled(p) && <span className="ml-1 text-[11px] text-zinc-400">Default</span>}
                      </h3>
                      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{p.description}</p>
                    </div>
                    <form action={toggle} className="shrink-0">
                      <input type="hidden" name="id" value={p.id} />
                      <input type="hidden" name="install" value={installed ? "0" : "1"} />
                      <button className={installed ? "btn btn-sm" : "btn btn-sm btn-primary"}>{installed ? "Uninstall" : "Install"}</button>
                    </form>
                  </div>
                  {p.requires && <p className="text-xs text-zinc-500">Needs: {p.requires}</p>}
                  {where && <p className="text-xs text-zinc-500">Here: {where}</p>}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </>
  );
}
