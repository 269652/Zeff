import { connection } from "next/server";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { isInstalled } from "@/plugins/state";
import { favorites, tree } from "@/plugins/workspace/store";
import { Sidebar } from "@/plugins/workspace/ui/Sidebar";

/** Workspace: pages and databases — the tree on the left, the page beside it. */
export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  await connection();
  if (!isInstalled("workspace")) return <PluginNotInstalled id="workspace" />;
  // System → Prompts: a page for every prompt (made once; an untouched one follows the built-in text).
  await (await import("@/lib/prompts")).ensureSystemPrompts().catch((e) => console.error("[workspace] the system prompts failed", e));
  // My briefing replaced by Meine Lage (once — also before the next Jira sync or start).
  if (isInstalled("jira-lage")) {
    const j = await import("@/plugins/jira-lage/to-workspace");
    await j.replaceBriefingOnce().catch((e) => console.error("[jira] Meine Lage as a pipeline database failed", e));
    j.sortBriefingOnce();
  }
  return (
    <div className="page">
      <div className="page-aside">
        <Sidebar items={tree()} favorites={favorites()} />
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
