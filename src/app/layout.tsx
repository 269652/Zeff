import { AgentInstructionsProvider } from "@/components/AgentInstructions";
import { LiveRefresh } from "@/components/LiveRefresh";
import { HashHighlight } from "@/components/HashHighlight";
import { AttentionBar } from "@/components/AttentionBar";
import { listAttention } from "@/lib/attention";
import { activityNewsIds } from "@/lib/boards/activity";
import { getWorkSettings } from "@/lib/work/store";
import type { Metadata } from "next";
import { connection } from "next/server";
import localFont from "next/font/local";
import { SiteHeader, type MenuGroup, type MenuLink } from "@/components/SiteHeader";
import { PLUGINS } from "@/plugins/catalog";
import { catalogText } from "@/plugins/catalog-text";
import { installedPlugins } from "@/plugins/state";
import { allApps, appTabs, getMenuPrefs } from "@/plugins/tabs";
import { inOrder } from "@/lib/layout-shared";
import { tabsWithMenu } from "@/plugins/tab-menus";
import { currentAccount, listAccounts } from "@/db/accounts";

/** Settings in the menu: the general ones, and the settings page of every installed plugin (language bundles: chosen in Settings itself). */
const settingsGroup = (): MenuGroup => {
  const on = installedPlugins();
  const nav = new Map(PLUGINS.flatMap((p) => (p.nav ?? []).map((n) => [n.href, n] as const)));
  // (Its overview first: every settings area on one page — "All settings" was an entry of its own beside this group.)
  const items: MenuLink[] = [
    { href: "/settings/all", label: t("Overview"), hint: t("Every settings area in one place") },
    { href: "/preferences", label: t("General"), hint: t("AI provider, language, backups") },
  ];
  if (on.has("todos")) items.push({ href: "/settings/todos", label: t("Todos"), hint: t("What a todo shows, and which kinds of knowledge count") });
  for (const p of PLUGINS) {
    if (!on.has(p.id) || p.category === "language" || !p.settings) continue;
    const href = p.settings.href;
    if (items.some((i) => i.href.split("#")[0] === href.split("#")[0])) continue;
    const n = nav.get(href);
    items.push({ href, label: n ? catalogText(t, n.label) : catalogText(t, p.name), hint: catalogText(t, p.settings.what) });
  }
  return { id: "settings", name: t("Settings"), items };
};
/** The installed plugins' menu entries: each plugin's pages and its settings page, under its name (its apps are under "Apps"). */
const pluginGroups = (): MenuGroup[] => {
  const on = installedPlugins();
  const settingsHrefs = new Set(settingsGroup().items.map((i) => i.href));
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
      // (the settings pages are under Settings — settingsGroup)
      const items = inOrder(nav.filter((n) => !seen.has(n.href) && !settingsHrefs.has(n.href)), (n) => n.href, order);
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
  const chip = (a: { id: string; name: string; color: string; host?: string }) => ({ id: a.id, name: a.name, color: a.color, ...(a.host ? { host: a.host } : {}) });
  return { current: chip(currentAccount()), list: listAccounts().map(chip) };
};
import { Toaster } from "@/components/Toaster";
import { LockWatcher } from "@/components/LockWatcher";
import { lockEnabled } from "@/lib/lock/shared";
import { SetupGate } from "@/components/SetupGate";
import { getAppSettings } from "@/lib/ai";
import { MainArea } from "@/components/MainArea";
import { PluginFlagsProvider } from "@/components/PluginFlags";
import { googleGrants } from "@/lib/google/grants";
import { getTodoDisplayOff } from "@/lib/todo-display-store";
import { PeopleProvider } from "@/plugins/people/PersonMention";
import { I18nProvider } from "@/components/I18nProvider";
import { applyLanguage, t } from "@/lib/i18n/server";
import "./globals.css";

// The fonts are files of the repository (Geist, SIL Open Font License): Zeff builds and runs without a connection.
const geistSans = localFont({ src: "./fonts/Geist-latin.woff2", variable: "--font-geist-sans", weight: "100 900", fallback: ["system-ui", "Arial"] });
const geistMono = localFont({ src: "./fonts/GeistMono-latin.woff2", variable: "--font-geist-mono", weight: "100 900", fallback: ["ui-monospace", "Consolas"] });

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: { default: "Zeff", template: "%s · Zeff" },
    description: t("Zeff — hourly time reports for jobs, with an MCP server for agents."),
  };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Every page is the account of its host (src/db/accounts.ts, the proxy's header): rendered per request, never prerendered
  // or kept for one account and served to the other.
  await connection();
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
      <body className="flex h-screen flex-col overflow-hidden" suppressHydrationWarning>
        <I18nProvider lang={lang}>
          {/* The first stop of the keyboard: past the header to the page itself (WCAG 2.4.1). */}
          <a href="#main" className="skip-link">
            {t("Skip to the content")}
          </a>
          <SiteHeader
            activityIds={activityNewsIds()}
            waiting={attention.flatMap((a) => (a.kind === "question" && a.href?.startsWith("/work") ? [{ href: "/work", title: a.title }] : []))}
            apps={allApps().map((a) => ({ href: a.href, label: a.label, hint: a.hint, place: a.place }))}
            pluginGroups={pluginGroups()}
            settingsGroup={settingsGroup()}
            hidden={getMenuPrefs().hidden}
            order={getMenuPrefs().order}
            tabs={headerTabs()}
            account={headerAccount()}
            bare={setupPending}
          />
          {!setupPending && <AttentionBar items={attention} />}
          <MainArea>
            <PluginFlagsProvider installed={[...installedPlugins()]} off={getTodoDisplayOff()} grants={setupPending ? [] : googleGrants()}>
              <AgentInstructionsProvider templates={getWorkSettings().agentInstructions}>
                <SetupGate pending={setupPending} allowed={setupPages()} account={installedPlugins().has("accounts") ? currentAccount().name : undefined}>
                  {/* People named in texts (todos) as links with hover cards — with the People plugin. */}
                  <PeopleProvider index={installedPlugins().has("people") ? await (await import("@/plugins/people/store")).peopleIndex() : []} hrefs={installedPlugins().has("people") && installedPlugins().has("workspace") ? (await import("@/plugins/workspace/people-database")).personHrefs() : {}}>
                    {children}
                  </PeopleProvider>
                </SetupGate>
              </AgentInstructionsProvider>
            </PluginFlagsProvider>
          </MainArea>
          <LiveRefresh />
          <LockWatcher enabled={lockEnabled()} />
          <HashHighlight />
          <Toaster />
        </I18nProvider>
      </body>
    </html>
  );
}
