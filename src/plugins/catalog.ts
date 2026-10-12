/**
 * Zeff's plugins: the applications (Todos, Work, the weekly and the monthly report), the
 * connectors and drivers (Jira, Outlook mail and calendar, Teams, GitLab), the time-sheet systems
 * (Roar, TimO) and the AI command-line tools (Copilot CLI, Claude CLI) — installed or not
 * (Menu → Plugins). What a plugin brings is only there while it's installed (and what it builds
 * on is): its tabs, menu entries, pages, syncs, sign-ins, AI provider. For your private life,
 * say, the work ones go and the rest stays. Client-safe (data only).
 */

export const PLUGIN_IDS = ["zeiterfassung", "weekly-report", "monthly-report", "todos", "tickets", "kanban", "jira-lage", "work", "work-elevated", "auto-actions", "backup", "accounts", "knowledge", "people", "documents", "jira", "llm", "copilot-cli", "claude-cli", "codex-cli", "outlook-mail", "gmail", "whatsapp", "signal", "keep", "keep-write", "calendar", "google-calendar", "outlook-calendar", "teams", "gitlab", "roar", "timo", "lang-en", "lang-de", "lang-es"] as const;
export type PluginId = (typeof PLUGIN_IDS)[number];
export const isPluginId = (v: unknown): v is PluginId => (PLUGIN_IDS as readonly unknown[]).includes(v);

export type PluginCategory = "app" | "ai" | "connector" | "timesheet" | "language" | "system";
export const PLUGIN_CATEGORY_LABELS: Record<PluginCategory, string> = { app: "Applications", ai: "AI tools", connector: "Connectors", timesheet: "Time-sheet systems", language: "Languages", system: "System" };

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
  /** Its settings page — the setup's "Set up" step and the menu link to it. */
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
  aiProvider?: "copilot" | "claude" | "codex";
  /** What it brings to other plugins — extensions (see extensions.ts), there while all their plugins are. */
  extensions?: import("./extensions").ExtensionDecl[];
  /** Beta: works, but may break — the warning shown with it (Plugins page, before installing, where it acts). */
  beta?: string;
};

export const PLUGINS: PluginManifest[] = [
  {
    id: "zeiterfassung",
    settings: { href: "/settings", what: "Working hours, absences, rules for meetings and reports" },
    name: "Time tracking",
    description: "The foundation of booking: jobs and projects, working hours and absences, the analysis of your entries. The weekly and monthly reports, Roar and TimO build on it.",
    category: "app",
    defaultInstalled: true,
    nav: [
      { href: "/jobs", label: "Jobs", hint: "Job numbers to book on" },
      { href: "/projects", label: "Projects", hint: "Work grouped under a job" },
      { href: "/settings", label: "Schedule", hint: "Working hours & absences" },
      { href: "/analysis", label: "Analysis", hint: "Charts of your bookings" },
      { href: "/feierabend", label: "End of day", hint: "Book the day in one click" },
    ],
    routes: ["/jobs", "/projects", "/settings", "/analysis", "/feierabend"],
  },
  {
    id: "weekly-report",
    name: "Weekly report",
    description: "Booking with the week in view: hours per job and day, breaks, flex time, the week's report, suggestions and “Done today” to take over.",
    category: "app",
    defaultInstalled: true,
    dependsOn: ["zeiterfassung"],
    tabs: [{ href: "/", label: "Weekly report", short: "Weekly", also: ["/entries", "/export"] }],
    routes: ["/"],
  },
  {
    id: "monthly-report",
    name: "Monthly report",
    description: "The month as a calendar and per job: what's booked, what's missing, what's approved.",
    category: "app",
    defaultInstalled: true,
    dependsOn: ["zeiterfassung"],
    tabs: [{ href: "/month", label: "Monthly report", short: "Monthly" }],
    routes: ["/month"],
  },
  {
    id: "todos",
    settings: { href: "/preferences", what: "The briefing's JQL filter" },
    name: "Todos",
    description: "The briefing: your tickets read by the AI — what happened, what to do — and the todos with their context, activity and recap.",
    category: "app",
    defaultInstalled: true,
    tabs: [
      { href: "/heute", label: "Today", short: "Today" },
      { href: "/todos", label: "Todos", short: "Todos" },
    ],
    routes: ["/heute", "/todos", "/t", "/api/boards"],
    syncSteps: ["boards", "recap"],
  },
  {
    id: "tickets",
    name: "Tickets",
    description: "The Tickets tab: the briefing per ticket — where it stands, what happened, its todos, comments, mails, merge requests and suggested actions — filterable by state. Builds on Todos (the same briefing run).",
    category: "app",
    defaultInstalled: true,
    dependsOn: ["todos"],
    tabs: [{ href: "/tickets", label: "Tickets", short: "Tickets" }],
    routes: ["/tickets"],
  },
  {
    id: "kanban",
    settings: { href: "/kanban/settings", what: "Create your own boards, columns, in the briefing" },
    name: "Kanban",
    description: "Your own boards like in Jira — for private projects or your own work boards: columns, cards (K-1, K-2 …) with description, labels, priority and due date, by drag & drop. Other plugins add their boards (Jira briefing).",
    category: "app",
    defaultInstalled: false,
    tabs: [{ href: "/kanban", label: "Kanban", short: "Kanban" }],
    nav: [{ href: "/kanban/settings", label: "Kanban boards", hint: "Manage your boards" }],
    routes: ["/kanban"],
  },
  {
    id: "jira-lage",
    name: "Jira briefing",
    description: "Your Jira boards as Kanban boards — the columns as in Jira, each card with its ticket's briefing from the briefing run: where it stands, what happened last, open todos, flags and suggested actions. Plus “My briefing”: the run's tickets.",
    category: "app",
    defaultInstalled: false,
    dependsOn: ["kanban", "todos", "jira"],
    syncSteps: ["boardlage"],
  },
  {
    id: "work",
    settings: { href: "/repos", what: "The repos the workers work in" },
    name: "Work",
    description: "Workers and agents on your todos: runs, live sessions, branches and repos, delivery — and the MCP tools for agents.",
    category: "app",
    defaultInstalled: true,
    dependsOn: ["todos", "llm"],
    tabs: [{ href: "/work", label: "Work", short: "Work" }],
    nav: [{ href: "/repos", label: "Repos", hint: "Where workers implement" }],
    routes: ["/work", "/api/work", "/repos"],
  },
  {
    id: "work-elevated",
    settings: { href: "/work/admin", what: "Ask Windows each time (UAC), or start them without asking (a scheduled task, set up once)" },
    name: "Admin sessions",
    description:
      "Live Claude sessions on the Work tab as administrator (Windows): installing software, services, system settings, anything that needs elevation. Each time Windows asks you (UAC) — or, set up once, a scheduled task starts them without asking.",
    category: "app",
    defaultInstalled: false,
    dependsOn: ["work", "claude-cli"],
    requires: "Windows, and an administrator account (UAC).",
    routes: ["/work/admin"],
    beta: "An administrator session can change anything on this computer — and in Bypass or Auto mode it does so without asking you first. Use Ask mode unless you know what it will do. Automatic start (the scheduled task) means no prompt at all: anything that can write to your user profile could get a process elevated through it. Set it up only on a computer you alone use.",
  },
  {
    id: "auto-actions",
    name: "Auto actions",
    description: "An AI step of its own after the briefing: every open todo without a button gets ready-made actions from what the installed plugins can do — a message, a comment, a mail draft, a meeting in a free slot, a hand-over to a worker. One click and it's done.",
    category: "ai",
    defaultInstalled: true,
    dependsOn: ["todos", "llm"],
    syncSteps: ["autoactions"],
  },
  {
    id: "backup",
    settings: { href: "/preferences#backups", what: "Where, how many, password" },
    name: "Backups",
    description: "Backs up Zeff's data (database, calendar inbox, logs) as a ZIP, AES-256 encrypted with a password — daily, keeping daily, weekly and monthly copies; restore in one click.",
    category: "system",
    defaultInstalled: true,
    nav: [{ href: "/preferences#backups", label: "Backups", hint: "Encrypted backups & restore" }],
  },
  // Language bundles: the words of Zeff's interface in a language (its bundle.json) — chosen per account in Settings.
  {
    id: "lang-en",
    settings: { href: "/preferences#language", what: "The language Zeff speaks" },
    name: "English",
    description: "Zeff in English — the language its texts are written in.",
    category: "language",
    defaultInstalled: true,
  },
  {
    id: "lang-de",
    settings: { href: "/preferences#language", what: "The language Zeff speaks" },
    name: "Deutsch",
    description: "Zeff auf Deutsch: alle Texte der Oberfläche, Datum und Zahlen im deutschen Format.",
    category: "language",
    defaultInstalled: true,
  },
  {
    id: "lang-es",
    settings: { href: "/preferences#language", what: "The language Zeff speaks" },
    name: "Español",
    description: "Zeff en español: todos los textos de la interfaz, fechas y números en formato español.",
    category: "language",
    defaultInstalled: true,
  },
  {
    id: "knowledge",
    name: "Knowledge",
    description: "Knowledge from Confluence: the knowledge server (knowledge/, a server of its own) compiles the pages with Copilot into a searchable knowledge graph. Here you ask it in a chat; on todos “Show knowledge” shows the matching pages, and agents search it (MCP).",
    category: "app",
    defaultInstalled: false,
    requires: "the knowledge server — the launcher (Zeff.exe) starts it; every further account with this plugin gets its own, with its own database",
    tabs: [{ href: "/knowledge", label: "Chat", short: "Chat" }],
    routes: ["/knowledge", "/graph"],
    extensions: [
      {
        key: "todo-knowledge",
        for: "todos",
        name: "Knowledge matching",
        description: "A step after every briefing: for each new or changed todo the AI checks the knowledge base's hits and keeps only what really fits — “Show knowledge” then shows exactly that.",
        requires: ["llm"],
        defaultInstalled: true,
        syncSteps: ["knowledgerel"],
      },
    ],
  },
  {
    id: "people",
    name: "People",
    description:
      "A profile for everyone who matters to you: your notes, their dates (birthday, anniversaries, whatever you want to remember) with a reminder — on the Today page and as a desktop notification — plus what Zeff knows about them: the knowledge (with the Knowledge plugin), their latest messages (WhatsApp, mail), the todos they appear in. Zeff finds dates in your facts and — with the LLM plugin — the AI finds them in knowledge and messages; you confirm them.",
    category: "app",
    defaultInstalled: false,
    apps: [{ href: "/personen", label: "People", short: "People", hint: "Profiles, birthdays, reminders" }],
    routes: ["/personen"],
    // Names in todos → people (aliases, new profiles, merges): with each briefing, through the AI.
    syncSteps: ["peoplenorm"],
  },
  {
    id: "documents",
    name: "Documents",
    description:
      "A store for your documents: drop text files, Office files, PDFs, pictures or audio — Zeff reads the text out of them (pictures and scanned PDFs through the Claude CLI; audio through a transcriber you set, e.g. Whisper) and, with the Knowledge plugin, the knowledge server compiles them: an abstract on hover, searchable, context for your todos. Attach a document to a todo by hand to give it as context.",
    category: "app",
    defaultInstalled: false,
    requires: "For pictures and scanned PDFs: the Claude CLI (scanned PDFs also Poppler's pdftoppm). For audio: a transcriber command.",
    apps: [{ href: "/documents", label: "Documents", short: "Docs", hint: "Drop documents, images, audio" }],
    settings: { href: "/documents#settings", what: "The audio transcriber" },
    routes: ["/documents", "/api/documents"],
    extensions: [
      {
        key: "doc-review",
        for: "todos",
        name: "Document review",
        description: "A step after every briefing: the AI reads new and changed documents and makes todos of what they ask of you — a deadline, a bill, a form, an open question — with the document as the source.",
        requires: ["llm"],
        defaultInstalled: true,
        syncSteps: ["doctodos"],
      },
      {
        key: "doc-relations",
        for: "todos",
        name: "Document matching",
        description: "A step after every briefing: the AI attaches to each open todo the documents it is about — by content. They then show on the todo, in its context and in the agents'.",
        requires: ["llm"],
        defaultInstalled: true,
        syncSteps: ["docrelations"],
      },
    ],
  },
  {
    id: "accounts",
    settings: { href: "/accounts", what: "Create and switch accounts" },
    name: "Accounts",
    description: "Several accounts — e.g. work and private — and switching between them. Each has its own data, settings, AI backends and installed plugins; a new one can take over another one's settings.",
    category: "system",
    defaultInstalled: false,
    nav: [{ href: "/accounts", label: "Accounts", hint: "Switch & manage accounts" }],
    routes: ["/accounts"],
  },
  {
    id: "jira",
    settings: { href: "/jira", what: "Address, access, chosen boards" },
    name: "Jira",
    description: "Your tickets and those of the chosen boards — the basis of the todos, the context sync and the entries per ticket.",
    category: "connector",
    defaultInstalled: true,
    requires: "The Jira MCP server (mcp-atlassian) with your access.",
    nav: [{ href: "/jira", label: "Jira", hint: "Boards, tickets & sync" }],
    routes: ["/jira"],
    syncSteps: ["jira"],
    services: ["jira"],
  },
  {
    id: "llm",
    settings: { href: "/llm", what: "AI backend and model per task, instructions" },
    name: "LLM",
    description: "The AI layer: all AI tasks (briefing, recap, mail steps, auto actions, workers) run through it — each with its own backend and model or the default, all with your instructions and your context. The backends are the CLI plugins.",
    category: "ai",
    defaultInstalled: true,
    nav: [{ href: "/llm", label: "LLM", hint: "AI backends, instructions & tasks" }],
    routes: ["/llm"],
  },
  {
    id: "copilot-cli",
    name: "GitHub Copilot CLI",
    description: "Copilot as the AI for the briefing, the mail steps and the workers — interactive too (ACP): permissions, questions and mode on the Work tab.",
    category: "ai",
    defaultInstalled: true,
    dependsOn: ["llm"],
    requires: "The Copilot CLI (npm install -g @github/copilot), signed in once (copilot → /login).",
    aiProvider: "copilot",
  },
  {
    id: "claude-cli",
    name: "Claude CLI",
    description: "Claude Code as the AI for the briefing and the workers — with model choice, permission mode and sending to Jira.",
    category: "ai",
    defaultInstalled: false,
    dependsOn: ["llm"],
    requires: "The Claude CLI (claude), signed in.",
    aiProvider: "claude",
  },
  {
    id: "codex-cli",
    name: "ChatGPT (Codex CLI)",
    description: "ChatGPT as the AI for the briefing, the mail steps and the other AI tasks — through OpenAI's Codex CLI, signed in with your ChatGPT account.",
    category: "ai",
    defaultInstalled: false,
    dependsOn: ["llm"],
    requires: "The Codex CLI (npm install -g @openai/codex), signed in once (codex login).",
    aiProvider: "codex",
  },
  {
    id: "outlook-mail",
    settings: { href: "/mail", what: "Which Outlook folders are read" },
    name: "Outlook Mail",
    description: "Reads your inbox in Outlook Web (only the list, nothing is opened) — mails as context for todos, the mail review and mail matching.",
    category: "connector",
    defaultInstalled: true,
    requires: "The automation Chrome with Outlook Web, signed in.",
    apps: [{ href: "/mail", label: "Messages", short: "Msgs", hint: "All mails and chats in one place, their sync" }],
    routes: ["/mail", "/api/boards/mail-relations"],
    syncSteps: ["mail", "mailtodos", "relations"],
    services: ["outlook"],
  },
  {
    id: "gmail",
    name: "Gmail",
    description: "Reads your Gmail inbox in the account's automation Chrome (only the list, nothing is opened or marked as read) — mails as context for todos, the mail review, mail matching and knowledge; with or instead of Outlook.",
    category: "connector",
    defaultInstalled: false,
    requires: "The account's automation Chrome with Gmail (mail.google.com), signed in.",
    apps: [
      { href: "/apps/gmail", label: "Gmail", short: "Gmail", hint: "Your Gmail mails, per account" },
      { href: "/mail", label: "Messages", short: "Msgs", hint: "All mails and chats in one place, their sync" },
    ],
    settings: { href: "/gmail", what: "Which Gmail accounts are read" },
    routes: ["/mail", "/apps/gmail", "/gmail", "/api/boards/mail-relations"],
    syncSteps: ["mail", "mailtodos", "relations"],
    services: ["gmail"],
    extensions: [
      {
        key: "compose-action",
        for: "auto-actions",
        name: "Write mail",
        description: "Auto actions also suggest mails (reply, ask, submit) — one click opens Gmail's draft, filled in; you send it yourself.",
        defaultInstalled: true,
        actions: ["gmail-compose"],
      },
    ],
  },
  {
    id: "whatsapp",
    name: "WhatsApp",
    description: "Reads your chats in WhatsApp Web in the account's automation Chrome — only the chat list (per chat the last message, who, when, unread); no chat is opened, so nothing is marked as read (no blue ticks). The messages go into the review (todos), matching and knowledge, just like mails.",
    category: "connector",
    defaultInstalled: false,
    requires: "The account's automation Chrome with WhatsApp Web (web.whatsapp.com), linked to your phone.",
    apps: [
      { href: "/apps/whatsapp", label: "WhatsApp", short: "WhatsApp", hint: "Your chats, their latest messages" },
      { href: "/mail", label: "Messages", short: "Msgs", hint: "All mails and chats in one place, their sync" },
    ],
    routes: ["/mail", "/apps/whatsapp", "/api/boards/mail-relations"],
    syncSteps: ["whatsapp", "mailtodos", "relations"],
    services: ["whatsapp"],
    extensions: [
      {
        key: "send-action",
        for: "auto-actions",
        name: "Send message",
        description: "Auto actions also suggest WhatsApp messages (reply, accept, propose a time) — ready-worded; they're only sent on your click, through WhatsApp Web in the automation Chrome.",
        defaultInstalled: true,
        actions: ["whatsapp-message"],
      },
    ],
  },
  {
    id: "signal",
    name: "Signal",
    description: "Reads your Signal chats from Signal Desktop on this computer (over its local debug port) — the messages of your active chats; no chat is opened, so nothing is marked as read. The messages go into the review (todos), matching and knowledge, just like mails.",
    category: "connector",
    defaultInstalled: false,
    beta: "Zeff reads Signal Desktop through its internals, over a debug port — a Signal update can change them and stop the sync until Zeff is adapted. While the port is open, any program on this computer could read Signal through it (as with the automation Chrome).",
    requires: "Signal Desktop on this computer, linked to your phone — running with its debug port (Zeff starts it so, or sets up its autostart).",
    apps: [
      { href: "/apps/signal", label: "Signal", short: "Signal", hint: "Your Signal chats, their latest messages" },
      { href: "/mail", label: "Messages", short: "Msgs", hint: "All mails and chats in one place, their sync" },
    ],
    routes: ["/mail", "/apps/signal", "/api/boards/mail-relations"],
    syncSteps: ["signal", "mailtodos", "relations"],
    services: ["signal"],
    extensions: [
      {
        key: "send-action",
        for: "auto-actions",
        name: "Send message",
        description: "Auto actions also suggest Signal messages (reply, accept, propose a time) — ready-worded; they are only sent on your click, through Signal Desktop.",
        defaultInstalled: true,
        actions: ["signal-message"],
      },
    ],
  },
  {
    id: "keep",
    name: "Google Keep",
    description: "Notes like in Google Keep: your own note boards in Zeff (Private, Ideas, Shopping …) with notes, lists, colours, labels — and your Google Keep notes, read in the account's automation Chrome (Keep opened in a new tab, what Keep loads taken over, tab closed; nothing changes in Keep). Everything is in the Keep app, in knowledge (also as a source of its own for the knowledge server), for agents — and with its extensions in the briefing and the todos.",
    category: "connector",
    defaultInstalled: false,
    requires: "For Google Keep: the account's automation Chrome, signed in to Google (keep.google.com). Your own boards need nothing.",
    tabs: [{ href: "/keep", label: "Keep", short: "Keep" }],
    settings: { href: "/keep/settings", what: "Your own note boards, the Google account" },
    routes: ["/keep", "/apps/keep"],
    syncSteps: ["keep"],
    services: ["keep"],
    extensions: [
      {
        key: "note-review",
        for: "todos",
        name: "Note review",
        description: "A step after every briefing: the AI reads new and changed notes (your boards in the briefing, Google Keep) and makes todos of what they ask of you — with the note as the source.",
        requires: ["llm"],
        defaultInstalled: true,
        syncSteps: ["notetodos"],
      },
      {
        key: "note-relations",
        for: "todos",
        name: "Note matching",
        description: "A step after every briefing: the AI attaches to each open todo the notes it is about — by content. They then show on the todo, in its context and in the agents'.",
        requires: ["llm"],
        defaultInstalled: true,
        syncSteps: ["noterelations"],
      },
      {
        key: "lage-context",
        for: "todos",
        name: "Notes in the briefing",
        description: "The notes attached to a ticket's todos or naming it go into the ticket's analysis too.",
        defaultInstalled: true,
      },
      {
        key: "note-action",
        for: "auto-actions",
        name: "Create note",
        description: "Auto actions also suggest keeping something as a note on one of your Keep boards (a shopping list, ideas, credential-free info to look up) — one click creates it.",
        defaultInstalled: true,
        actions: ["keep-note"],
      },
    ],
  },
  {
    id: "keep-write",
    name: "Google Keep write",
    description:
      "Makes your Google Keep notes editable in Zeff: new notes and lists, title and text, ticks, colours, labels, pinning, archiving, moving to the bin — every change saved in Google Keep right away, and Zeff shows the note as Keep confirmed it.",
    category: "connector",
    defaultInstalled: false,
    dependsOn: ["keep"],
    requires: "The account's automation Chrome, signed in to Google (keep.google.com).",
    beta: "Zeff writes through Keep's own web interface — as if by hand, in a tab of the automation Chrome. If Google changes that interface, a write can fail or only partly succeed. Each change takes about half a minute. For anything important: check in Keep.",
  },
  {
    id: "calendar",
    name: "Calendar",
    description: "One calendar for everything: your own calendars in Zeff and those of your sources (Outlook, Google Calendar) in one week view, each with a colour, to show or hide. Zeff reads every source into its own calendar model — that's where the free slots for meeting suggestions and the meetings to book come from. Your todos' suggested meetings show dashed.",
    category: "app",
    defaultInstalled: false,
    tabs: [{ href: "/kalender", label: "Calendar", short: "Cal." }],
    settings: { href: "/kalender/einstellungen", what: "Your calendars, their colours, which count as busy and get booked" },
    routes: ["/kalender"],
    extensions: [
      {
        key: "entry-action",
        for: "auto-actions",
        name: "Event in the Zeff calendar",
        description: "Auto actions suggest meetings, time blocks and reminders for todos — in a free slot; one click puts them into your Zeff calendar.",
        defaultInstalled: true,
        actions: ["calendar-entry"],
      },
    ],
  },
  {
    id: "google-calendar",
    name: "Google Calendar",
    description: "Reads your Google calendars in the account's automation Chrome — the week view in a new tab, week by week (last week, this one and the next three), then closed again; nothing changes in Google. Every Google calendar (yours, family, birthdays …) shows in the Calendar app, its events count for free slots.",
    category: "connector",
    defaultInstalled: false,
    requires: "The account's automation Chrome, signed in to Google (calendar.google.com).",
    dependsOn: ["calendar"],
    syncSteps: ["gcalendar"],
    services: ["gcalendar"],
    extensions: [
      {
        key: "event-action",
        for: "auto-actions",
        name: "Event in Google Calendar",
        description: "Auto actions suggest Google Calendar events for todos — in a free slot; one click opens Google's form, filled in; you save it yourself.",
        defaultInstalled: true,
        actions: ["gcal-event"],
      },
    ],
  },
  {
    id: "outlook-calendar",
    name: "Outlook Calendar",
    description: "Reads your meetings from Outlook (automation Chrome, bookmarklet or Microsoft sign-in) — meetings to book, with job and exclusion rules.",
    category: "connector",
    defaultInstalled: true,
    requires: "The automation Chrome with Outlook Web, signed in.",
    apps: [{ href: "/calendar", label: "Book meetings", short: "Book", hint: "The calendars' meetings, taken over as entries" }],
    routes: ["/calendar", "/import", "/api/calendar"],
    syncSteps: ["calendar"],
    services: ["outlook"],
  },
  {
    id: "teams",
    name: "Microsoft Teams",
    description: "Reads your mentions and chats in Teams Web — context for the briefing and todos; sends Teams messages on a click.",
    category: "connector",
    defaultInstalled: true,
    requires: "The automation Chrome with Teams Web, signed in.",
    apps: [{ href: "/teams", label: "Teams", short: "Teams", hint: "Your mentions and messages" }],
    routes: ["/teams"],
    syncSteps: ["teams"],
    services: ["teams"],
  },
  {
    id: "gitlab",
    settings: { href: "/gitlab", what: "Your GitLab's address" },
    name: "GitLab",
    description: "Reads merge requests, comments and branches — context, delivery (push, MR, merge) and replies to comments on a click.",
    category: "connector",
    defaultInstalled: true,
    requires: "The automation Chrome with GitLab, signed in (and git).",
    nav: [{ href: "/gitlab", label: "GitLab", hint: "Merge requests, comments & branches" }],
    routes: ["/gitlab"],
    syncSteps: ["gitlab"],
    services: ["gitlab"],
  },
  {
    id: "roar",
    name: "Roar",
    description: "Exports your entries to Roar and reads back what's booked, approvals and jobs from there (ticks in the reports).",
    category: "timesheet",
    defaultInstalled: true,
    dependsOn: ["zeiterfassung"],
    requires: "The automation Chrome with Roar, signed in.",
    routes: ["/export/roar"],
    syncSteps: ["roar"],
    services: ["roar"],
  },
  {
    id: "timo",
    name: "TimO",
    description: "Exports your days to TimO (arrival, departure, breaks) and reads them back.",
    category: "timesheet",
    defaultInstalled: true,
    dependsOn: ["zeiterfassung"],
    requires: "The automation Chrome with TimO, signed in.",
    routes: ["/export/timo"],
    syncSteps: ["timo"],
    services: ["timo"],
  },
];

export const pluginById = (id: PluginId) => PLUGINS.find((p) => p.id === id)!;

/** Steps that need another plugin than their own as well (the mail steps work on todos). */
/**
 * What a sync step needs besides its own plugin — a list in the list: any of them (the Ticket-Lage reads
 * Jira or your Kanban boards, or both; without either, Todos has mails, your own, Work).
 */
export const STEP_NEEDS: Record<string, (PluginId | PluginId[])[]> = { boards: ["llm", ["jira", "kanban"]], recap: ["llm"], mailtodos: ["todos", "llm"], relations: ["todos", "llm"], boardlage: ["jira", "llm"], peoplenorm: ["llm"] };
/** All the plugins that bring a step (Mail: Outlook Mail and Gmail) — any of them installed makes it there. */
export const pluginsOfStep = (key: string) => PLUGINS.filter((p) => p.syncSteps?.includes(key)).map((p) => p.id);
/** All the plugins that own a page. */
export const pluginsOfRoute = (path: string) => PLUGINS.filter((p) => p.routes?.some((r) => path === r || (r !== "/" && path.startsWith(`${r}/`)))).map((p) => p.id);
export const pluginsOfService = (service: string) => PLUGINS.filter((p) => p.services?.includes(service)).map((p) => p.id);
export const pluginOfProvider = (provider: string) => PLUGINS.find((p) => p.aiProvider === provider)?.id ?? null;
