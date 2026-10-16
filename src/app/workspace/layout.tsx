import { connection } from "next/server";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { isInstalled } from "@/plugins/state";
import { favorites, tree, unreadCounts } from "@/plugins/workspace/store";
import { Sidebar } from "@/plugins/workspace/ui/Sidebar";

/** Workspace: pages and databases — the tree on the left, the page beside it. */
export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  await connection();
  if (!isInstalled("workspace")) return <PluginNotInstalled id="workspace" />;
  // Your mails and messages as databases (once).
  await (await import("@/plugins/workspace/mail-databases")).ensureMailDatabases().catch((e) => console.error("[workspace] the mail databases failed", e));
  // Your people as a database (once; People installed).
  (await import("@/plugins/workspace/row-views")).retireDetailLayouts();
  await (await import("@/plugins/workspace/people-database")).ensurePeopleDatabase().catch((e) => console.error("[workspace] the people database failed", e));
  // The news you kept as a database (once; News installed).
  await (await import("@/plugins/workspace/news-database")).ensureNewsDatabase().catch((e) => console.error("[workspace] the news database failed", e));
  // Your calendar as a database (once; Calendar installed).
  await (await import("@/plugins/workspace/calendar-database")).ensureCalendarDatabase().catch((e) => console.error("[workspace] the calendar database failed", e));
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
        <Sidebar items={tree()} favorites={favorites()} unread={unreadCounts()} channels={(await import("@/plugins/workspace/derived")).channelKinds()} extSources={(await (await import("@/plugins/workspace/source-point")).extSources()).map((x) => ({ id: x.id, label: x.label, icon: x.icon }))} />
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
