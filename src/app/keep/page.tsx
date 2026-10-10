import { redirect } from "next/navigation";
import { connection } from "next/server";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { listKeepBoards } from "@/plugins/keep/boards";
import { keepCount } from "@/plugins/keep/store";
import { isInstalled } from "@/plugins/state";

/** Keep: to Google Keep when it has notes (or no board of yours yet), else to your first board. */
export default async function KeepPage() {
  await connection();
  if (!isInstalled("keep")) return <PluginNotInstalled id="keep" />;
  const first = listKeepBoards()[0];
  redirect(keepCount() > 0 || !first ? "/keep/google" : `/keep/${first.id}`);
}
