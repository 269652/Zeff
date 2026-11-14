import { redirect } from "next/navigation";
import { connection } from "next/server";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { isInstalled } from "@/plugins/state";

/** /explorer: the Explorer lives in the Workspace — its page (made the first time) is opened. */
export default async function ExplorerPage() {
  await connection();
  if (!isInstalled("explorer")) return <PluginNotInstalled id="explorer" />;
  if (!isInstalled("workspace")) return <PluginNotInstalled id="workspace" />;
  const { explorerPage } = await import("@/plugins/explorer/pages");
  redirect(`/workspace/${explorerPage()}`);
}
