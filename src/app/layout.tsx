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
import { catalogText } from "@/plugins/catalog-text";
import { installedPlugins } from "@/plugins/state";
import { allApps, appTabs, getMenuPrefs } from "@/plugins/tabs";
import { inOrder } from "@/lib/layout-shared";
import { tabsWithMenu } from "@/plugins/tab-menus";
import { currentAccount, listAccounts } from "@/db/accounts";

/** The installed plugins' menu entries: each plugin's pages and its settings page, under its name (its apps are under "Apps"). */
const pluginGroups = (): MenuGroup[] => {
  const on = installedPlugins();
  const appHrefs = new Set(allApps().map((a) => a.href));
  // Zeiterfassung's pages (Jobs, Projects …) first, then connectors and time-sheet systems, the applications' pages (Repos) after.
  const rank = { connector: 1, timesheet: 2, ai: 3, app: 4, system: 5, language: 6 } as const;
  const seen = new Set<string>();
  const { order } = getMenuPrefs();
  // Language bundles aren't menu entries: the language is chosen in Settings.
  const groups = PLUGINS.filter((p) => on.has(p.id) && p.category !== "language")
    .sort((a, b) => (a.id === "zeiterfassung" ? 0 : rank[a.category]) - (b.id === "zeiterfassung" ? 0 : rank[b.category]))
    .map((p) => {
      const nav = (p.nav ?? []).filter((n) => !appHrefs.has(n.href)).map((n) => ({ ...n, label: catalogText(t, n.label), hint: catalogText(t, n.hint) }));
      const settings = p.settings && !nav.some((n) => n.href === p.settings!.href) ? [{ href: p.settings.href, label: t("Settings"), hint: catalogText(t, p.settings.what) }] : [];
      const items = inOrder([...nav, ...settings].filter((n) => !seen.has(n.href)), (n) => n.href, order);
      for (const n of items) seen.add(n.href);
      return { id: p.id, name: catalogText(t, p.name), items };
    })
    .filter((g) => g.items.length);
  // In the order you put them in (Menu → Anpassen).
  return inOrder(groups, (g) => `group:${g.id}`, order);
};
/** The header's tabs — those whose plugin gives a dropdown (Kanban's boards) as split buttons. */
const headerTabs = () => {
  const withMenu = tabsWithMenu();
  return appTabs().map((tab) => ({ href: tab.href, label: tab.label, short: tab.short, also: tab.also, menu: withMenu.has(tab.href) }));
};
/** The pages the setup assistant leads to: its steps, the plugins' settings, sign-ins, syncs, accounts. */
const setupPages = () => ["/setup", "/logins", "/sync-settings", "/plugins", "/accounts", "/preferences", ...PLUGINS.flatMap((p) => (p.settings ? [p.settings.href.split(/[?#]/)[0]] : []))];
/** The account you're in and the others — only with the Accounts plugin. */
const headerAccount = () => {
  if (!installedPlugins().has("accounts")) return undefined;
  const chip = (a: { id: string; name: string; color: string }) => ({ id: a.id, name: a.name, color: a.color });
  return { current: chip(currentAccount()), list: listAccounts().map(chip) };
};
import { Toaster } from "@/components/Toaster";
import { SetupGate } from "@/components/SetupGate";
import { getAppSettings } from "@/lib/ai";
import { MainArea } from "@/components/MainArea";
import { PluginFlagsProvider } from "@/components/PluginFlags";
import { getTodoDisplayOff } from "@/lib/todo-display-store";
import { PeopleProvider } from "@/plugins/people/PersonMention";
import { I18nProvider } from "@/components/I18nProvider";
import { applyLanguage, t } from "@/lib/i18n/server";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: { default: "Zeff", template: "%s · Zeff" },
    description: t("Zeff — hourly time reports for jobs, with an MCP server for agents."),
  };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Not set up yet (a new Zeff, a new account): a bare header, and the way into the setup assistant.
  const setupPending = !getAppSettings().setupDoneAt;
  // The account's language (Settings): the page's, and the browser's for its own components.
  const lang = applyLanguage();
  // What needs you: sign-ins as a bar, a waiting Work session as a dot on its tab.
  const attention = setupPending ? [] : await listAttention();
  return (
    <html
      lang={lang}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      {/* An app shell: the window is the page — the body never scrolls; the content does, in itself. */}
      <body className="flex h-screen flex-col overflow-hidden">
        <I18nProvider lang={lang}>
          <SiteHeader
            activityIds={activityNewsIds()}
            waiting={attention.flatMap((a) => (a.kind === "question" && a.href?.startsWith("/work") ? [{ href: "/work", title: a.title }] : []))}
            apps={allApps().map((a) => ({ href: a.href, label: a.label, hint: a.hint, place: a.place }))}
            pluginGroups={pluginGroups()}
            hidden={getMenuPrefs().hidden}
            order={getMenuPrefs().order}
            tabs={headerTabs()}
            account={headerAccount()}
            bare={setupPending}
          />
          {!setupPending && <AttentionBar items={attention} />}
          <MainArea>
            <PluginFlagsProvider installed={[...installedPlugins()]} off={getTodoDisplayOff()}>
              <AgentInstructionsProvider templates={getWorkSettings().agentInstructions}>
                <SetupGate pending={setupPending} allowed={setupPages()} account={installedPlugins().has("accounts") ? currentAccount().name : undefined}>
                  {/* People named in texts (todos) as links with hover cards — with the People plugin. */}
                  <PeopleProvider index={installedPlugins().has("people") ? await (await import("@/plugins/people/store")).peopleIndex() : []}>{children}</PeopleProvider>
                </SetupGate>
              </AgentInstructionsProvider>
            </PluginFlagsProvider>
          </MainArea>
          <LiveRefresh />
          <HashHighlight />
          <Toaster />
        </I18nProvider>
      </body>
    </html>
  );
}
