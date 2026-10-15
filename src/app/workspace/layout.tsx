import { connection } from "next/server";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { isInstalled } from "@/plugins/state";
import { favorites, tree } from "@/plugins/workspace/store";
import { Sidebar } from "@/plugins/workspace/ui/Sidebar";

/** Workspace: pages and databases — the tree on the left, the page beside it. */
export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  await connection();
  if (!isInstalled("workspace")) return <PluginNotInstalled id="workspace" />;
  return (
    <div className="page">
      <div className="page-aside">
        <Sidebar items={tree()} favorites={favorites()} />
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
