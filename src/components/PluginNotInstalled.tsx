import Link from "next/link";
import { pluginById, type PluginId } from "@/plugins/catalog";
import { PluginInstallButton } from "./PluginInstallButton";

/** A plugin's page while the plugin isn't installed: what it would bring, and installing it. */
export function PluginNotInstalled({ id }: { id: PluginId }) {
  const p = pluginById(id);
  return (
    <div className="card mx-auto max-w-xl space-y-3 p-6 text-sm">
      <h1 className="text-lg font-semibold">{p.name} ist nicht installiert</h1>
      <p className="text-zinc-600 dark:text-zinc-300">{p.description}</p>
      {p.requires && <p className="text-xs text-zinc-500">Braucht: {p.requires}</p>}
      <div className="flex items-center gap-3">
        <PluginInstallButton id={id} installed={false} />
        <Link href="/plugins" className="text-indigo-600 hover:underline dark:text-indigo-400">
          Alle Plugins →
        </Link>
      </div>
    </div>
  );
}
