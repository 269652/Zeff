/**
 * Zeff's plugins: the applications (Todos, Work, the weekly and the monthly report), the
 * connectors and drivers (Jira, Outlook mail and calendar, Teams, GitLab), the time-sheet systems
 * (Chrono, Punch) and the AI command-line tools (Copilot CLI, Claude CLI) — installed or not
 * (Menu → Plugins). What a plugin brings is only there while it's installed (and what it builds
 * on is): its tabs, menu entries, pages, syncs, sign-ins, AI provider. For your private life,
 * say, the work ones go and the rest stays. Client-safe (data only).
 */

export const PLUGIN_IDS = ["zeiterfassung", "weekly-report", "monthly-report", "todos", "tickets", "kanban", "jira-lage", "work", "auto-actions", "backup", "accounts", "knowledge", "people", "jira", "llm", "copilot-cli", "claude-cli", "outlook-mail", "gmail", "whatsapp", "keep", "keep-write", "outlook-calendar", "teams", "gitlab", "chrono", "punch"] as const;
export type PluginId = (typeof PLUGIN_IDS)[number];
export const isPluginId = (v: unknown): v is PluginId => (PLUGIN_IDS as readonly unknown[]).includes(v);

export type PluginCategory = "app" | "ai" | "connector" | "timesheet" | "system";
export const PLUGIN_CATEGORY_LABELS: Record<PluginCategory, string> = { app: "Anwendungen", ai: "KI-Werkzeuge", connector: "Konnektoren", timesheet: "Zeiterfassungs-Systeme", system: "System" };

export type PluginManifest = {
  id: PluginId;
  name: string;
  description: string;
  category: PluginCategory;
  /** Installed when Zeff starts out (until you change it). */
  defaultInstalled: boolean;
  /** What it needs on this machine, in words. */
  requires?: string;
  /** The plugins it builds on — without them it isn't there either (installing it installs them). */
  dependsOn?: PluginId[];
  /** Its tabs in the header (an application's). */
  tabs?: { href: string; label: string; short: string; also?: string[] }[];
  /** Its settings page — the setup's "Einrichten" step and the menu link to it. */
  settings?: { href: string; what: string };
  /** Its applications beside the tabs — views of what it reads (Mail, Gmail, WhatsApp …): under "Apps" in the menu by default (the layout settings move them). */
  apps?: { href: string; label: string; short: string; hint: string }[];
  /** Its entries in the menu drawer. */
  nav?: { href: string; label: string; hint: string }[];
  /** The pages it owns (a prefix each) — "not installed" while it isn't. */
  routes?: string[];
  /** The sync steps it brings (Sync menu, scheduler). */
  syncSteps?: string[];
  /** The services it signs in to (sign-in prompts). */
  services?: string[];
  /** The AI provider it is. */
  aiProvider?: "copilot" | "claude";
  /** What it brings to other plugins — extensions (see extensions.ts), there while all their plugins are. */
  extensions?: import("./extensions").ExtensionDecl[];
  /** Beta: works, but may break — the warning shown with it (Plugins page, before installing, where it acts). */
  beta?: string;
};

export const PLUGINS: PluginManifest[] = [
  {
    id: "zeiterfassung",
    settings: { href: "/settings", what: "Arbeitszeiten, Abwesenheiten, Regeln für Meetings und Berichte" },
    name: "Zeiterfassung",
    description: "Das Fundament des Buchens: Jobs und Projekte, die Arbeitszeiten und Abwesenheiten, die Auswertung der Buchungen. Wochen- und Monatsbericht, Chrono und Punch bauen darauf.",
    category: "app",
    defaultInstalled: true,
    nav: [
      { href: "/jobs", label: "Jobs", hint: "Job numbers to book on" },
      { href: "/projects", label: "Projects", hint: "Work grouped under a job" },
      { href: "/settings", label: "Schedule", hint: "Working hours & absences" },
      { href: "/analysis", label: "Analysis", hint: "Charts of your bookings" },
      { href: "/feierabend", label: "Feierabend", hint: "Den Tag mit einem Klick buchen" },
    ],
    routes: ["/jobs", "/projects", "/settings", "/analysis", "/feierabend"],
  },
  {
    id: "weekly-report",
    name: "Wochenbericht",
    description: "Buchen und die Woche im Blick: Stunden pro Job und Tag, Pausen, Gleitzeit, der Bericht der Woche, Vorschläge und „Heute erledigt“ zum Übernehmen.",
    category: "app",
    defaultInstalled: true,
    dependsOn: ["zeiterfassung"],
    tabs: [{ href: "/", label: "Weekly report", short: "Weekly", also: ["/entries", "/export"] }],
    routes: ["/"],
  },
  {
    id: "monthly-report",
    name: "Monatsbericht",
    description: "Der Monat als Kalender und je Job: was gebucht ist, was fehlt, was freigegeben ist.",
    category: "app",
    defaultInstalled: true,
    dependsOn: ["zeiterfassung"],
    tabs: [{ href: "/month", label: "Monthly report", short: "Monthly" }],
    routes: ["/month"],
  },
  {
    id: "todos",
    settings: { href: "/preferences", what: "Der JQL-Filter der Ticket-Lage" },
    name: "Todos",
    description: "Die Ticket-Lage: deine Tickets durch die KI — was passiert ist, was zu tun ist —, die Todos mit ihrem Kontext, Aktivität und Recap.",
    category: "app",
    defaultInstalled: true,
    tabs: [
      { href: "/heute", label: "Heute", short: "Heute" },
      { href: "/todos", label: "Todos", short: "Todos" },
    ],
    routes: ["/heute", "/todos", "/t", "/api/boards"],
    syncSteps: ["boards", "recap"],
  },
  {
    id: "tickets",
    name: "Tickets",
    description: "Der Tickets-Tab: die Ticket-Lage je Ticket — wie es steht, was passiert ist, seine Todos, Kommentare, Mails, Merge Requests und vorgeschlagenen Aktionen —, nach Lage filterbar. Baut auf den Todos (derselbe Lage-Lauf).",
    category: "app",
    defaultInstalled: true,
    dependsOn: ["todos"],
    tabs: [{ href: "/tickets", label: "Tickets", short: "Tickets" }],
    routes: ["/tickets"],
  },
  {
    id: "kanban",
    settings: { href: "/kanban/settings", what: "Eigene Boards anlegen, Spalten, in der Ticket-Lage" },
    name: "Kanban",
    description: "Eigene Boards wie in Jira — für private Projekte oder eigene Arbeits-Boards: Spalten, Karten (K-1, K-2 …) mit Beschreibung, Labels, Priorität und Fälligkeit, per Drag & Drop. Andere Plugins bringen ihre Boards dazu (Jira Lage).",
    category: "app",
    defaultInstalled: false,
    tabs: [{ href: "/kanban", label: "Kanban", short: "Kanban" }],
    nav: [{ href: "/kanban/settings", label: "Kanban-Boards", hint: "Manage your boards" }],
    routes: ["/kanban"],
  },
  {
    id: "jira-lage",
    name: "Jira Lage",
    description: "Deine Jira-Boards als Kanban-Boards — die Spalten wie in Jira, jede Karte mit der Lage ihres Tickets aus dem Lage-Lauf: wie es steht, was zuletzt passiert ist, offene Todos, Flags und vorgeschlagene Aktionen. Dazu „Meine Lage“: die Tickets des Laufs.",
    category: "app",
    defaultInstalled: false,
    dependsOn: ["kanban", "todos", "jira"],
    syncSteps: ["boardlage"],
  },
  {
    id: "work",
    settings: { href: "/repos", what: "Die Repos, in denen die Worker arbeiten" },
    name: "Work",
    description: "Worker und Agenten an deinen Todos: Läufe, Live-Sitzungen, Branches und Repos, die Auslieferung — und die MCP-Werkzeuge für Agenten.",
    category: "app",
    defaultInstalled: true,
    dependsOn: ["todos", "llm"],
    tabs: [{ href: "/work", label: "Work", short: "Work" }],
    nav: [{ href: "/repos", label: "Repos", hint: "Where workers implement" }],
    routes: ["/work", "/api/work", "/repos"],
  },
  {
    id: "auto-actions",
    name: "Auto-Aktionen",
    description: "Ein eigener KI-Schritt nach der Ticket-Lage: jedes offene Todo ohne Knopf bekommt fertige Aktionen aus dem, was die installierten Plugins können — Nachricht, Kommentar, Mail-Entwurf, Termin in einer freien Zeit, Übergabe an einen Worker. Ein Klick, und es ist getan.",
    category: "ai",
    defaultInstalled: true,
    dependsOn: ["todos", "llm"],
    syncSteps: ["autoactions"],
  },
  {
    id: "backup",
    settings: { href: "/preferences#backups", what: "Wohin, wie viele, Passwort" },
    name: "Backups",
    description: "Sichert Zeffs Daten (Datenbank, Kalender-Eingang, Logs) als ZIP, mit Passwort AES-256-verschlüsselt — täglich, mit Tages-, Wochen- und Monatsständen; wiederherstellen auf Klick.",
    category: "system",
    defaultInstalled: true,
    nav: [{ href: "/preferences#backups", label: "Backups", hint: "Encrypted backups & restore" }],
  },
  {
    id: "knowledge",
    name: "Knowledge",
    description: "Wissen aus Confluence: der Wissens-Server (knowledge/, eigener Server) kompiliert die Seiten mit Copilot zu einem durchsuchbaren Wissensgraphen. Hier fragst du ihn im Chat; an Todos zeigt „Show knowledge“ die passenden Seiten, und Agenten suchen darin (MCP).",
    category: "app",
    defaultInstalled: false,
    requires: "den Wissens-Server — der Launcher (Zeff.exe) startet ihn; jedes weitere Konto mit diesem Plugin bekommt einen eigenen, mit eigener Datenbank",
    tabs: [{ href: "/knowledge", label: "Chat", short: "Chat" }],
    routes: ["/knowledge", "/graph"],
    extensions: [
      {
        key: "todo-knowledge",
        for: "todos",
        name: "Wissens-Zuordnung",
        description: "Ein Schritt nach jeder Ticket-Lage: die KI prüft für jedes neue oder geänderte Todo die Treffer der Wissensbasis und behält nur, was wirklich passt — „Show knowledge“ zeigt dann genau das.",
        requires: ["llm"],
        defaultInstalled: true,
        syncSteps: ["knowledgerel"],
      },
    ],
  },
  {
    id: "people",
    name: "Personen",
    description:
      "Ein Profil für jeden Menschen, der dir wichtig ist: deine Notizen, ihre Daten (Geburtstag, Jahrestage, was du dir merken willst) mit Erinnerung — auf der Heute-Seite und als Hinweis auf dem Desktop —, dazu, was Zeff von ihnen weiß: das Wissen (mit dem Knowledge-Plugin), ihre letzten Nachrichten (WhatsApp, Mail), die Todos, in denen sie vorkommen. Daten findet Zeff in deinen Fakten und — mit dem LLM-Plugin — die KI in Wissen und Nachrichten; du bestätigst sie.",
    category: "app",
    defaultInstalled: false,
    apps: [{ href: "/personen", label: "Personen", short: "Personen", hint: "Profile, Geburtstage, Erinnerungen" }],
    routes: ["/personen"],
  },
  {
    id: "accounts",
    settings: { href: "/accounts", what: "Konten anlegen und wechseln" },
    name: "Konten",
    description: "Mehrere Konten — z. B. Arbeit und Privat — und der Wechsel zwischen ihnen. Jedes hat seine eigenen Daten, Einstellungen, KI-Backends und installierten Plugins; ein neues kann die Einstellungen eines anderen übernehmen.",
    category: "system",
    defaultInstalled: false,
    nav: [{ href: "/accounts", label: "Konten", hint: "Switch & manage accounts" }],
    routes: ["/accounts"],
  },
  {
    id: "jira",
    settings: { href: "/jira", what: "Adresse, Zugang, gewählte Boards" },
    name: "Jira",
    description: "Deine Tickets und die der gewählten Boards — Grundlage der Todos, der Kontext-Synchronisation und der Buchungen pro Ticket.",
    category: "connector",
    defaultInstalled: true,
    requires: "Der Jira-MCP-Server (mcp-atlassian) mit deinem Zugang.",
    nav: [{ href: "/jira", label: "Jira", hint: "Boards, tickets & sync" }],
    routes: ["/jira"],
    syncSteps: ["jira"],
    services: ["jira"],
  },
  {
    id: "llm",
    settings: { href: "/llm", what: "KI-Backend und Modell je Aufgabe, Anweisungen" },
    name: "LLM",
    description: "Die KI-Schicht: alle KI-Aufgaben (Ticket-Lage, Recap, Mail-Schritte, Auto-Aktionen, Worker) laufen hierüber — jede mit eigenem Backend und Modell oder dem Standard, alle mit deinen Anweisungen und deinem Kontext. Backends sind die CLI-Plugins.",
    category: "ai",
    defaultInstalled: true,
    nav: [{ href: "/llm", label: "LLM", hint: "AI backends, instructions & tasks" }],
    routes: ["/llm"],
  },
  {
    id: "copilot-cli",
    name: "GitHub Copilot CLI",
    description: "Copilot als KI für die Ticket-Lage, die Mail-Steps und die Worker — auch interaktiv (ACP): Erlaubnisse, Rückfragen und Modus auf dem Work-Tab.",
    category: "ai",
    defaultInstalled: true,
    dependsOn: ["llm"],
    requires: "Die Copilot CLI (npm install -g @github/copilot), einmal angemeldet (copilot → /login).",
    aiProvider: "copilot",
  },
  {
    id: "claude-cli",
    name: "Claude CLI",
    description: "Claude Code als KI für die Ticket-Lage und die Worker — mit Modellwahl, Rechte-Modus und dem Senden nach Jira.",
    category: "ai",
    defaultInstalled: false,
    dependsOn: ["llm"],
    requires: "Die Claude CLI (claude), angemeldet.",
    aiProvider: "claude",
  },
  {
    id: "outlook-mail",
    settings: { href: "/mail", what: "Welche Outlook-Ordner gelesen werden" },
    name: "Outlook Mail",
    description: "Liest deinen Posteingang in Outlook Web (nur die Liste, nichts wird geöffnet) — Mails als Kontext für Todos, die Mail-Durchsicht und die Mail-Zuordnung.",
    category: "connector",
    defaultInstalled: true,
    requires: "Die Automations-Chrome mit Outlook Web, angemeldet.",
    apps: [{ href: "/mail", label: "Nachrichten", short: "Nachr.", hint: "Alle Mails und Chats an einem Ort, ihr Sync" }],
    routes: ["/mail", "/api/boards/mail-relations"],
    syncSteps: ["mail", "mailtodos", "relations"],
    services: ["outlook"],
  },
  {
    id: "gmail",
    name: "Gmail",
    description: "Liest deinen Gmail-Posteingang im Automations-Chrome des Kontos (nur die Liste, nichts wird geöffnet oder als gelesen markiert) — Mails als Kontext für Todos, die Mail-Durchsicht, die Mail-Zuordnung und das Wissen; mit oder statt Outlook.",
    category: "connector",
    defaultInstalled: false,
    requires: "Die Automations-Chrome des Kontos mit Gmail (mail.google.com), angemeldet.",
    apps: [
      { href: "/apps/gmail", label: "Gmail", short: "Gmail", hint: "Deine Gmail-Mails, je Konto" },
      { href: "/mail", label: "Nachrichten", short: "Nachr.", hint: "Alle Mails und Chats an einem Ort, ihr Sync" },
    ],
    settings: { href: "/gmail", what: "Welche Gmail-Konten gelesen werden" },
    routes: ["/mail", "/apps/gmail", "/gmail", "/api/boards/mail-relations"],
    syncSteps: ["mail", "mailtodos", "relations"],
    services: ["gmail"],
    extensions: [
      {
        key: "compose-action",
        for: "auto-actions",
        name: "Mail schreiben",
        description: "Auto-Aktionen schlagen auch Mails vor (antworten, anfragen, einreichen) — ein Klick öffnet Gmails Entwurf, ausgefüllt; senden tust du selbst.",
        defaultInstalled: true,
        actions: ["gmail-compose"],
      },
    ],
  },
  {
    id: "whatsapp",
    name: "WhatsApp",
    description: "Liest deine Chats in WhatsApp Web im Automations-Chrome des Kontos — nur die Chatliste (je Chat die letzte Nachricht, wer, wann, ungelesen); kein Chat wird geöffnet, also nichts als gelesen markiert (keine blauen Haken). Die Nachrichten laufen wie Mails in die Durchsicht (Todos), die Zuordnung und das Wissen.",
    category: "connector",
    defaultInstalled: false,
    requires: "Die Automations-Chrome des Kontos mit WhatsApp Web (web.whatsapp.com), mit deinem Telefon verknüpft.",
    apps: [
      { href: "/apps/whatsapp", label: "WhatsApp", short: "WhatsApp", hint: "Deine Chats, ihre letzten Nachrichten" },
      { href: "/mail", label: "Nachrichten", short: "Nachr.", hint: "Alle Mails und Chats an einem Ort, ihr Sync" },
    ],
    routes: ["/mail", "/apps/whatsapp", "/api/boards/mail-relations"],
    syncSteps: ["whatsapp", "mailtodos", "relations"],
    services: ["whatsapp"],
    extensions: [
      {
        key: "send-action",
        for: "auto-actions",
        name: "Nachricht senden",
        description: "Auto-Aktionen schlagen auch WhatsApp-Nachrichten vor (antworten, zusagen, eine Uhrzeit vorschlagen) — fertig formuliert; gesendet wird erst auf deinen Klick, über WhatsApp Web im Automations-Chrome.",
        defaultInstalled: true,
        actions: ["whatsapp-message"],
      },
    ],
  },
  {
    id: "keep",
    name: "Google Keep",
    description: "Notizen wie in Google Keep: eigene Notiz-Boards in Zeff (Privat, Ideen, Einkauf …) mit Notizen, Listen, Farben, Labels — und deine Google-Keep-Notizen, gelesen im Automations-Chrome des Kontos (Keep in einem neuen Tab geöffnet, übernommen, was Keep lädt, Tab zu; in Keep ändert sich nichts). Alles steht in der Keep-App, im Wissen (auch als eigene Quelle des Wissens-Servers), für Agenten — und mit seinen Erweiterungen in der Ticket-Lage und den Todos.",
    category: "connector",
    defaultInstalled: false,
    requires: "Für Google Keep: die Automations-Chrome des Kontos, bei Google angemeldet (keep.google.com). Die eigenen Boards brauchen nichts.",
    tabs: [{ href: "/keep", label: "Keep", short: "Keep" }],
    settings: { href: "/keep/settings", what: "Eigene Notiz-Boards, das Google-Konto" },
    routes: ["/keep", "/apps/keep"],
    syncSteps: ["keep"],
    services: ["keep"],
    extensions: [
      {
        key: "note-review",
        for: "todos",
        name: "Notiz-Durchsicht",
        description: "Ein Schritt nach jeder Ticket-Lage: die KI liest neue und geänderte Notizen (deine Boards in der Lage, Google Keep) und macht Todos aus dem, was sie dir aufgeben — mit der Notiz als Quelle.",
        requires: ["llm"],
        defaultInstalled: true,
        syncSteps: ["notetodos"],
      },
      {
        key: "note-relations",
        for: "todos",
        name: "Notiz-Zuordnung",
        description: "Ein Schritt nach jeder Ticket-Lage: die KI hängt jedem offenen Todo die Notizen an, um die es geht — nach Inhalt. Sie stehen dann am Todo, in seinem Kontext und dem der Agenten.",
        requires: ["llm"],
        defaultInstalled: true,
        syncSteps: ["noterelations"],
      },
      {
        key: "lage-context",
        for: "todos",
        name: "Notizen in der Ticket-Lage",
        description: "Die Notizen, die an den Todos eines Tickets hängen oder es nennen, gehen mit in die Auswertung des Tickets.",
        defaultInstalled: true,
      },
      {
        key: "note-action",
        for: "auto-actions",
        name: "Notiz anlegen",
        description: "Auto-Aktionen schlagen auch vor, etwas als Notiz in einem deiner Keep-Boards festzuhalten (eine Einkaufsliste, Ideen, Zugangsdaten-freie Infos zum Nachschlagen) — ein Klick legt sie an.",
        defaultInstalled: true,
        actions: ["keep-note"],
      },
    ],
  },
  {
    id: "keep-write",
    name: "Google Keep schreiben",
    description:
      "Macht deine Google-Keep-Notizen in Zeff bearbeitbar: neue Notizen und Listen, Titel und Text, Häkchen, Farben, Labels, Anheften, Archivieren, in den Papierkorb — jede Änderung gleich in Google Keep gespeichert, und Zeff zeigt die Notiz so, wie Keep sie bestätigt hat.",
    category: "connector",
    defaultInstalled: false,
    dependsOn: ["keep"],
    requires: "Die Automations-Chrome des Kontos, bei Google angemeldet (keep.google.com).",
    beta: "Zeff schreibt über Keeps eigene Web-Oberfläche — wie von Hand, in einem Tab der Automations-Chrome. Ändert Google diese Oberfläche, kann ein Schreiben scheitern oder nur zum Teil gelingen. Jede Änderung dauert etwa eine halbe Minute. Für Wichtiges: in Keep nachsehen.",
  },
  {
    id: "outlook-calendar",
    name: "Outlook Kalender",
    description: "Liest deine Termine aus Outlook (Automations-Chrome, Lesezeichen oder Microsoft-Anmeldung) — Meetings zum Buchen, mit Job- und Ausschlussregeln.",
    category: "connector",
    defaultInstalled: true,
    requires: "Die Automations-Chrome mit Outlook Web, angemeldet.",
    apps: [{ href: "/calendar", label: "Kalender", short: "Kalender", hint: "Outlook-Termine, als Einträge übernehmen" }],
    routes: ["/calendar", "/import", "/api/calendar"],
    syncSteps: ["calendar"],
    services: ["outlook"],
  },
  {
    id: "teams",
    name: "Microsoft Teams",
    description: "Liest deine Erwähnungen und Chats in Teams Web — Kontext für die Ticket-Lage und Todos; sendet Teams-Nachrichten auf Klick.",
    category: "connector",
    defaultInstalled: true,
    requires: "Die Automations-Chrome mit Teams Web, angemeldet.",
    apps: [{ href: "/teams", label: "Teams", short: "Teams", hint: "Deine Erwähnungen und Nachrichten" }],
    routes: ["/teams"],
    syncSteps: ["teams"],
    services: ["teams"],
  },
  {
    id: "gitlab",
    settings: { href: "/gitlab", what: "Die Adresse deines GitLab" },
    name: "GitLab",
    description: "Liest Merge Requests, Kommentare und Branches — Kontext, Auslieferung (Push, MR, Merge) und Antworten auf Kommentare auf Klick.",
    category: "connector",
    defaultInstalled: true,
    requires: "Die Automations-Chrome mit GitLab, angemeldet (und git).",
    nav: [{ href: "/gitlab", label: "GitLab", hint: "Merge requests, comments & branches" }],
    routes: ["/gitlab"],
    syncSteps: ["gitlab"],
    services: ["gitlab"],
  },
  {
    id: "chrono",
    name: "Chrono",
    description: "Exportiert deine Buchungen nach Chrono und liest dort Gebuchtes, Freigaben und Jobs zurück (Häkchen in den Berichten).",
    category: "timesheet",
    defaultInstalled: true,
    dependsOn: ["zeiterfassung"],
    requires: "Die Automations-Chrome mit Chrono, angemeldet.",
    routes: ["/export/chrono"],
    syncSteps: ["chrono"],
    services: ["chrono"],
  },
  {
    id: "punch",
    name: "Punch",
    description: "Exportiert deine Tage nach Punch (Kommen, Gehen, Pausen) und liest sie zurück.",
    category: "timesheet",
    defaultInstalled: true,
    dependsOn: ["zeiterfassung"],
    requires: "Die Automations-Chrome mit Punch, angemeldet.",
    routes: ["/export/punch"],
    syncSteps: ["punch"],
    services: ["punch"],
  },
];

export const pluginById = (id: PluginId) => PLUGINS.find((p) => p.id === id)!;

/** Steps that need another plugin than their own as well (the mail steps work on todos). */
/**
 * What a sync step needs besides its own plugin — a list in the list: any of them (the Ticket-Lage reads
 * Jira or your Kanban boards, or both; without either, Todos has mails, your own, Work).
 */
export const STEP_NEEDS: Record<string, (PluginId | PluginId[])[]> = { boards: ["llm", ["jira", "kanban"]], recap: ["llm"], mailtodos: ["todos", "llm"], relations: ["todos", "llm"], boardlage: ["jira", "llm"] };

/** The plugin that brings a sync step / owns a page / signs in to a service — none: it's Zeff's own. */
export const pluginOfStep = (key: string) => PLUGINS.find((p) => p.syncSteps?.includes(key))?.id ?? null;
/** All the plugins that bring a step (Mail: Outlook Mail and Gmail) — any of them installed makes it there. */
export const pluginsOfStep = (key: string) => PLUGINS.filter((p) => p.syncSteps?.includes(key)).map((p) => p.id);
/** All the plugins that own a page. */
export const pluginsOfRoute = (path: string) => PLUGINS.filter((p) => p.routes?.some((r) => path === r || (r !== "/" && path.startsWith(`${r}/`)))).map((p) => p.id);
export const pluginOfRoute = (path: string) => PLUGINS.find((p) => p.routes?.some((r) => path === r || (r !== "/" && path.startsWith(`${r}/`))))?.id ?? null;
export const pluginsOfService = (service: string) => PLUGINS.filter((p) => p.services?.includes(service)).map((p) => p.id);
export const pluginOfProvider = (provider: string) => PLUGINS.find((p) => p.aiProvider === provider)?.id ?? null;
