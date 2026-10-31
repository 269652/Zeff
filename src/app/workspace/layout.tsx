import { connection } from "next/server";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { currentAccountId } from "@/db/accounts";
import { setupOnce } from "@/lib/setup-once";
import { installedPlugins, isInstalled } from "@/plugins/state";
import { favorites, templateTree, tree } from "@/plugins/workspace/store";
import { MobileAside } from "@/plugins/workspace/ui/MobileAside";
import { Sidebar } from "@/plugins/workspace/ui/Sidebar";

/** The one-time moves done for good (lib/once-done), by their version: a change to what one does takes a new one. */
const MIGRATIONS = { dataBlocks: "workspace.dataBlocks@1" };

/** Workspace: pages and databases — the tree on the left, the page beside it. */
export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  await connection();
  if (!isInstalled("workspace")) return <PluginNotInstalled id="workspace" />;
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
    const { lastDone, markDone, onceDone } = await import("@/lib/once-done");
    // The pages' old data blocks (figure, chart, appointments, todos, document, people) as Kennzahlen, widgets and views (once each):
    // every page the first time, after that only the pages edited since the last run in which none failed.
    try {
      const since = lastDone(MIGRATIONS.dataBlocks) ?? undefined;
      const started = new Date().toISOString();
      const blocks = { failed: 0 };
      await (await import("@/plugins/workspace/data-block-migration")).migrateDataBlocks(blocks, since);
      if (!blocks.failed) markDone(MIGRATIONS.dataBlocks, started);
    } catch (e) {
      console.error("[workspace] moving the old data blocks failed", e);
    }
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
      const j = await import("@/plugins/jira-lage/to-workspace");
      await j.replaceBriefingOnce().catch((e) => console.error("[jira] Meine Lage as a pipeline database failed", e));
      j.sortBriefingOnce();
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
      <div className="page-aside ws-aside">
        <MobileAside>
          <Sidebar builtins={builtins} templateItems={templateTree()} appNav={appNav} items={tree()} favorites={favorites()} badges={badges} channels={channels} extSources={extSources} />
        </MobileAside>
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
