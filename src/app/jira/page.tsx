import type { Metadata } from "next";
import { connection } from "next/server";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { redirect } from "@/lib/redirect";
import { isInstalled } from "@/plugins/state";

export const metadata: Metadata = { title: "Jira" };

/**
 * Jira lives in the Workspace: its database "Jira" (the synced tickets) shown by Jira's app view (src/plugins/jira/view-template.meta.ts) —
 * yours and the AI's to change. This is the way in the links have always used (/jira, /jira?mine=1).
 */
export default async function JiraPage({ searchParams }: { searchParams: Promise<{ mine?: string }> }) {
  await connection();
  if (!isInstalled("jira")) return <PluginNotInstalled id="jira" />;
  const id = await (await import("@/plugins/jira/workspace-app")).jiraApp();
  if (!id) return <PluginNotInstalled id="workspace" />;
  return redirect(`/workspace/${id}${(await searchParams).mine === "1" ? "?s.mine=true" : ""}`);
}
