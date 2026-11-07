import { t } from "@/lib/i18n/server";
import { PLUGINS } from "@/plugins/catalog";
import { catalogText } from "@/plugins/catalog-text";
import { installedPlugins } from "@/plugins/state";

/** A settings area: its page (or a section of one), its name, what is set there. */
export type SettingsArea = { href: string; label: string; what: string };
export type SettingsAreaGroup = { id: string; title: string; areas: SettingsArea[]; /** Listed in the menu's Settings too (else only on the hub). */ menu: boolean };

const path = (href: string) => href.split("#")[0];

/**
 * Every settings area, grouped — one list for the Settings hub (/settings) and the menu's Settings, so both name each area alike.
 * A plugin's settings that are a section of a page listed already (LLM → AI, Gmail and Google Drive → Connections) aren't listed
 * again; Code's settings (a section of the time-tracking settings) are an area of their own.
 */
export function settingsAreas(): SettingsAreaGroup[] {
  const on = installedPlugins();
  const general: SettingsArea[] = [
    { href: "/preferences", label: t("General"), what: t("Language, parallel work, security key, lock") },
    { href: "/settings/ai", label: t("AI"), what: t("Backends and models, your instructions, the prompts, how useful each step is") },
    ...(on.has("todos") ? [{ href: "/settings/todos", label: t("Todo settings"), what: t("The briefing, what a todo shows, which kinds of knowledge count") }] : []),
  ];
  const time: SettingsArea[] = [
    ...(on.has("zeiterfassung") ? [{ href: "/settings/time", label: t("Time-tracking settings"), what: t("Weekly hours, breaks, flex time, rules, absences") }] : []),
    ...(on.has("work") ? [{ href: "/settings/time#work", label: t("Code"), what: t("How the sessions and workers run: permission modes, limits, model, house rules") }] : []),
  ];
  const mail = ["mail-client", "outlook-mail", "gmail", "imap-mail"] as const;
  const connections: SettingsArea[] = [
    // The mail accounts' one place (Gmail, Outlook, IMAP, POP3): there while anything mail is installed (Mail & Chat is by default).
    ...(mail.some((id) => on.has(id)) ? [{ href: "/settings/mail", label: t("E-Mail accounts"), what: t("Add a mail account (Gmail, Outlook, T-Online, GMX, IMAP, POP3), its folders, the attachments") }] : []),
    { href: "/settings/connections", label: t("Connections"), what: t("Per service: API or automation Chrome, the sign-ins, Google Drive, how often each sync runs") },
  ];
  const listed = [...general, ...time, ...connections].map((a) => path(a.href));
  const plugins: SettingsArea[] = [
    { href: "/plugins", label: t("Plugins"), what: t("Install or remove connectors and AI tools") },
    ...PLUGINS.filter((p) => on.has(p.id) && p.category !== "language" && p.settings).map((p) => ({ href: p.settings!.href, label: catalogText(t, p.name), what: catalogText(t, p.settings!.what) })),
  ].filter((a, i, all) => all.findIndex((x) => path(x.href) === path(a.href)) === i && !listed.includes(path(a.href)));
  const backup: SettingsArea[] = [
    ...(on.has("backup") ? [{ href: "/preferences#backups", label: t("Backups"), what: t("Encrypted backups and restore") }] : []),
    ...(on.has("accounts") ? [{ href: "/accounts", label: t("Accounts"), what: t("Separate data sets, each with its own settings") }] : []),
    { href: "/settings/mobile", label: t("Mobile access"), what: t("Zeff on your phone through Tailscale — the database stays on this computer") },
    { href: "/diagnostics", label: t("Diagnostics"), what: t("Health of the app, its syncs and the automation Chrome") },
    { href: "/privacy", label: t("What leaves this PC"), what: t("Every outgoing connection, listed") },
    { href: "/privacy/boundaries", label: t("Data boundaries"), what: t("What may flow where: open, personal, secret") },
  ];
  return [
    { id: "general", title: t("General & AI"), areas: general, menu: true },
    { id: "time", title: t("Time tracking"), areas: time, menu: true },
    { id: "connections", title: t("Connections"), areas: connections, menu: true },
    { id: "plugins", title: t("Plugins"), areas: plugins, menu: true },
    { id: "backup", title: t("Backup & accounts"), areas: backup, menu: false },
  ].filter((g) => g.areas.length);
}

/**
 * The sections of the settings pages (each page's table of contents), for the search: "Lock", "Gmail accounts", "Weekly hours"
 * find their place — each with its page's name. Only what is there (a plugin's section with its plugin installed).
 */
export function settingsSections(): SettingsArea[] {
  const on = installedPlugins();
  const general = t("General");
  const ai = t("AI");
  const conn = t("Connections");
  const time = t("Time-tracking settings");
  const all: (SettingsArea | false)[] = [
    { href: "/preferences#language", label: t("Language"), what: general },
    { href: "/preferences#parallel", label: t("Parallel work"), what: general },
    { href: "/preferences#touch", label: t("Touch to approve"), what: general },
    { href: "/preferences#lock", label: t("Lock"), what: general },
    on.has("backup") && { href: "/preferences#backups", label: t("Backups"), what: general },
    { href: "/settings/ai#backends", label: t("Backends"), what: ai },
    on.has("llm") && { href: "/settings/ai#instructions", label: t("Instructions, context & tasks"), what: ai },
    { href: "/settings/ai#prompts", label: t("The prompts"), what: ai },
    { href: "/settings/ai#ai-quality", label: t("AI quality"), what: ai },
    { href: "/settings/connections#api", label: t("APIs"), what: conn },
    { href: "/settings/connections#sign-ins", label: t("Browser sign-ins"), what: conn },
    { href: "/settings/connections#syncs", label: t("Sync settings"), what: conn },
    on.has("gmail") && { href: "/settings/mail/account/gmail", label: t("Gmail accounts"), what: t("E-Mail accounts") },
    { href: "/settings/mail/add", label: t("Add mail account"), what: t("E-Mail accounts") },
    on.has("google-drive") && { href: "/settings/connections#google-drive", label: t("Google Drive"), what: conn },
    on.has("todos") && { href: "/settings/todos#boards", label: t("Todos (briefing)"), what: t("Todo settings") },
    ...(on.has("zeiterfassung")
      ? [
          { href: "/settings/time#hours", label: t("Weekly hours"), what: time },
          { href: "/settings/time#breaks", label: t("Default break"), what: time },
          { href: "/settings/time#flex", label: t("Flex time"), what: time },
          { href: "/settings/time#types", label: t("Entry type rules"), what: time },
          { href: "/settings/time#report", label: t("Report rewriting"), what: time },
          on.has("outlook-calendar") && { href: "/settings/time#meetings", label: t("Meetings"), what: time },
          { href: "/settings/time#absences", label: t("Absence"), what: time },
        ]
      : []),
    on.has("workspace") && { href: "/workspace/settings/sources", label: t("Data sources"), what: t("Workspace settings") },
    on.has("workspace") && { href: "/workspace/settings/outputs", label: t("Outputs"), what: t("Workspace settings") },
    on.has("workspace") && { href: "/workspace/settings/pipelines", label: t("Pipelines"), what: t("Workspace settings") },
    on.has("workspace") && { href: "/workspace/settings/apps", label: t("Apps"), what: t("Workspace settings") },
  ];
  return all.filter((a): a is SettingsArea => !!a);
}
