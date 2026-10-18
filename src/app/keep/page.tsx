import { redirect } from "next/navigation";
import { connection } from "next/server";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { listKeepBoards } from "@/plugins/keep/boards";
import { keepCount } from "@/plugins/keep/store";
import { isInstalled } from "@/plugins/state";

/** Keep: to Google Keep when it has notes (or no board of yours yet), else to your first board. */
export default async function KeepPage() {
  await connection();
  if (!isInstalled("notes")) return <PluginNotInstalled id="notes" />;
  // Keep's boards moved into the Workspace: there (Google Keep's database first, once it's kept there).
  if (isInstalled("workspace")) {
    const w = await import("@/plugins/keep/to-workspace");
    const href = w.googleKeepHref() ?? (w.movedNoteDatabases()[0] ? `/workspace/${w.movedNoteDatabases()[0].dbId}` : null);
    if (href) redirect(href);
  }
  const first = listKeepBoards()[0];
  redirect(keepCount() > 0 || !first ? "/keep/google" : `/keep/${first.id}`);
}
