import { connection } from "next/server";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { currentAccountId } from "@/db/accounts";
import { setupOnce } from "@/lib/setup-once";
import { installedPlugins, isInstalled } from "@/plugins/state";
import { favorites, templateTree, tree } from "@/plugins/workspace/store";
import { MobileAside } from "@/plugins/workspace/ui/MobileAside";
import { Sidebar } from "@/plugins/workspace/ui/Sidebar";
import { TreeBadgeLook } from "@/plugins/workspace/ui/TreeBadge";

/** The one-time moves done for good (lib/once-done), by their version: a change to what one does takes a new one. */

/** Workspace: pages and databases — the tree on the left, the page beside it. */
export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  await connection();
  if (!isInstalled("workspace")) return <PluginNotInstalled id="workspace" />;
  // (Mail & Chat's port: its views made before its current template brought up to date — once per account, a single read after)
  await (await import("@/plugins/mail-client/to-plugin")).upgradeMailPortViews().catch((e) => console.error("[mail-client-ext] upgrading its views failed", e));
  // What the Workspace makes for itself (its databases, the prompts' pages …): once per account and set of plugins — not on every
  // page opened (it cost most of a second each time), again after a while for what was connected since.
  await setupOnce(`workspace:${currentAccountId()}:${[...installedPlugins()].sort().join(",")}`, async () => {
    // Your mails and messages as databases (once).
    await (await import("@/plugins/workspace/mail-databases")).ensureMailDatabases().catch((e) => console.error("[workspace] the mail databases failed", e));
    // Your people as a database (once; People installed).
    (await import("@/plugins/workspace/row-views")).retireDetailLayouts();
    await (await import("@/plugins/workspace/people-database")).ensurePeopleDatabase().catch((e) => console.error("[workspace] the people database failed", e));
    // Your cases as a database (once; Cases installed).
    await (await import("@/plugins/cases/database")).ensureCasesDatabase().catch((e) => console.error("[workspace] the cases database failed", e));
    // Organisations, projects and places as databases (once each; Entities installed).
    await (await import("@/plugins/entities/database")).ensureEntityDatabases().catch((e) => console.error("[workspace] the entity databases failed", e));
    await (await import("@/plugins/finances/database")).ensureDebtsDatabase().catch((e) => console.error("[workspace] the debts database failed", e));
    // The news you kept as a database (once; News installed).
    await (await import("@/plugins/workspace/news-database")).ensureNewsDatabase().catch((e) => console.error("[workspace] the news database failed", e));
    // The search knows what the cells of the rows say (once: pages made before it are read in again).
    (await import("@/plugins/workspace/store")).reindexOnce();
    // Your calendar as a database (once; Calendar installed).
    await (await import("@/plugins/workspace/calendar-database")).ensureCalendarDatabase().catch((e) => console.error("[workspace] the calendar database failed", e));
    // Your unread documents as an inbox (once; Documents installed).
    await (await import("@/plugins/workspace/document-databases")).ensureDocumentDatabases().catch((e) => console.error("[workspace] the document inbox failed", e));
    // Your automations and their runs as rows (once; the visible list of what ran).
    await (await import("@/plugins/workspace/automation-databases")).ensureAutomationDatabases().catch((e) => console.error("[workspace] the automation databases failed", e));
    // System → Prompts: a page for every prompt (made once; an untouched one follows the built-in text).
    await (await import("@/lib/prompts")).ensureSystemPrompts().catch((e) => console.error("[workspace] the system prompts failed", e));
    // My briefing replaced by Meine Lage (once — also before the next Jira sync or start).
    if (isInstalled("jira-lage")) {
      await (await import("@/plugins/jira-lage/to-workspace")).replaceBriefingOnce().catch((e) => console.error("[jira] Meine Lage as a pipeline database failed", e));
    }
  }).catch((e) => console.error("[workspace] setting up failed", e));
  // What the sidebar shows beside the tree, gathered at once. The Templates in the tree: the built-in ones (yours are pages: their tree).
  const [builtins, appNav, channels, extSources, badges] = await Promise.all([
    import("@/plugins/workspace/templates").then((m) => m.templateMetas().flatMap(({ key, name, icon, kind, category }) => (category === "mine" ? [] : [{ key, name, icon, kind, category }]))),
    import("@/plugins/workspace/app-nav").then((m) => m.appNavs()),
    import("@/plugins/workspace/derived").then((m) => m.channelKinds()),
    import("@/plugins/workspace/source-point").then((m) => m.extSources()).then((list) => list.filter((x) => !x.relationOnly).map((x) => ({ id: x.id, label: x.label, icon: x.icon }))),
    // The pages' badges (what waits on them): the kept ones, a new reading only briefly waited for.
    import("@/plugins/workspace/badges").then((m) => m.pageBadges({ wait: 300 })),
  ]);
  return (
    <div className="page">
      <div className="page-aside ws-aside lg:top-3 lg:max-h-none lg:pb-0">
        <MobileAside>
          {/* The badges' colours as set under Settings → Badges. */}
          <TreeBadgeLook tones={(await import("@/plugins/workspace/badge-config-store")).getWsBadges().tones}>
            <Sidebar builtins={builtins} templateItems={templateTree()} appNav={appNav} items={tree()} favorites={favorites()} badges={badges} channels={channels} extSources={extSources} />
          </TreeBadgeLook>
        </MobileAside>
      </div>
      {/* Room below the last card: the main area itself only leaves 12 px on a desktop. */}
      <div className="min-w-0 pb-6">{children}</div>
    </div>
  );
}
