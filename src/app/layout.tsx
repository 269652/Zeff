import { AgentInstructionsProvider } from "@/components/AgentInstructions";
import { LiveRefresh } from "@/components/LiveRefresh";
import { HashHighlight } from "@/components/HashHighlight";
import { AttentionBar } from "@/components/AttentionBar";
import { listAttention } from "@/lib/attention";
import { activityNewsIds } from "@/lib/boards/activity";
import { getWorkSettings } from "@/lib/work/store";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SiteHeader, type MenuGroup } from "@/components/SiteHeader";
import { PLUGINS } from "@/plugins/catalog";
import { installedPlugins } from "@/plugins/state";
import { allApps, appTabs, getMenuPrefs } from "@/plugins/tabs";
import { tabsWithMenu } from "@/plugins/tab-menus";
import { currentAccount, listAccounts } from "@/db/accounts";

/** The installed plugins' menu entries: each plugin's pages and its settings page, under its name (its apps are under "Apps"). */
const pluginGroups = (): MenuGroup[] => {
  const on = installedPlugins();
  const appHrefs = new Set(allApps().map((a) => a.href));
  // Zeiterfassung's pages (Jobs, Projects …) first, then connectors and time-sheet systems, the applications' pages (Repos) after.
  const rank = { connector: 1, timesheet: 2, ai: 3, app: 4, system: 5 } as const;
  const seen = new Set<string>();
  return PLUGINS.filter((p) => on.has(p.id))
    .sort((a, b) => (a.id === "zeiterfassung" ? 0 : rank[a.category]) - (b.id === "zeiterfassung" ? 0 : rank[b.category]))
    .map((p) => {
      const nav = (p.nav ?? []).filter((n) => !appHrefs.has(n.href));
      const settings = p.settings && !nav.some((n) => n.href === p.settings!.href) ? [{ href: p.settings.href, label: "Einstellungen", hint: p.settings.what }] : [];
      const items = [...nav, ...settings].filter((n) => !seen.has(n.href));
      for (const n of items) seen.add(n.href);
      return { id: p.id, name: p.name, items };
    })
    .filter((g) => g.items.length);
};
/** The header's tabs — those whose plugin gives a dropdown (Kanban's boards) as split buttons. */
const headerTabs = () => {
  const withMenu = tabsWithMenu();
  return appTabs().map((t) => ({ href: t.href, label: t.label, short: t.short, also: t.also, menu: withMenu.has(t.href) }));
};
/** The account you're in and the others — only with the Accounts plugin. */
const headerAccount = () => {
  if (!installedPlugins().has("accounts")) return undefined;
  const chip = (a: { id: string; name: string; color: string }) => ({ id: a.id, name: a.name, color: a.color });
  return { current: chip(currentAccount()), list: listAccounts().map(chip) };
};
import { Toaster } from "@/components/Toaster";
import { MainArea } from "@/components/MainArea";
import { PluginFlagsProvider } from "@/components/PluginFlags";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Zeff", template: "%s · Zeff" },
  description: "Zeff — hourly time reports for jobs, with an MCP server for agents.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      {/* An app shell: the window is the page — the body never scrolls; the content does, in itself. */}
      <body className="flex h-screen flex-col overflow-hidden">
        <SiteHeader activityIds={activityNewsIds()} apps={allApps().map((a) => ({ href: a.href, label: a.label, hint: a.hint, place: a.place }))} pluginGroups={pluginGroups()} hidden={getMenuPrefs().hidden} tabs={headerTabs()} account={headerAccount()} />
        <AttentionBar items={await listAttention()} />
        <MainArea>
          <PluginFlagsProvider installed={[...installedPlugins()]}>
            <AgentInstructionsProvider templates={getWorkSettings().agentInstructions}>{children}</AgentInstructionsProvider>
          </PluginFlagsProvider>
        </MainArea>
        <LiveRefresh />
        <HashHighlight />
        <Toaster />
      </body>
    </html>
  );
}
