/**
 * The mail providers an account is added for, and what each allows: their servers for mail programs (IMAP, POP3, SMTP — the
 * values the providers publish, checked 2026-11) and, for Gmail and Outlook, Zeff's own ways (their API, the automation
 * Chrome). Client-safe.
 */

export type SmtpSecurity = "tls" | "starttls";
/** How a mailbox is read: its service's API, the automation Chrome, or a mail program's protocol. */
export type MailMethod = "api" | "browser" | "imap" | "pop3";
export type ProviderId = "gmail" | "outlook" | "t-online" | "gmx" | "web-de" | "other";

export type Server = { host: string; port: number; tls: boolean };
export type MailProvider = {
  id: ProviderId;
  name: string;
  /** The ways it can be read, the recommended first. */
  methods: MailMethod[];
  imap: Server;
  pop3: Server;
  smtp: { host: string; port: number; security: SmtpSecurity };
  /** The provider keeps a copy of what is sent over its SMTP server itself (Gmail, Microsoft): Zeff doesn't add one. */
  keepsSent: boolean;
};

export const MAIL_PROVIDERS: MailProvider[] = [
  {
    id: "gmail",
    name: "Gmail",
    methods: ["api", "browser", "imap"],
    imap: { host: "imap.gmail.com", port: 993, tls: true },
    pop3: { host: "pop.gmail.com", port: 995, tls: true },
    smtp: { host: "smtp.gmail.com", port: 465, security: "tls" },
    keepsSent: true,
  },
  {
    id: "outlook",
    name: "Outlook / Microsoft 365",
    methods: ["api", "browser", "imap"],
    imap: { host: "outlook.office365.com", port: 993, tls: true },
    pop3: { host: "outlook.office365.com", port: 995, tls: true },
    smtp: { host: "smtp.office365.com", port: 587, security: "starttls" },
    keepsSent: true,
  },
  {
    id: "t-online",
    name: "T-Online (Telekom)",
    methods: ["imap", "pop3"],
    imap: { host: "secureimap.t-online.de", port: 993, tls: true },
    pop3: { host: "securepop.t-online.de", port: 995, tls: true },
    smtp: { host: "securesmtp.t-online.de", port: 465, security: "tls" },
    keepsSent: false,
  },
  {
    id: "gmx",
    name: "GMX",
    methods: ["imap", "pop3"],
    imap: { host: "imap.gmx.net", port: 993, tls: true },
    pop3: { host: "pop.gmx.net", port: 995, tls: true },
    smtp: { host: "mail.gmx.net", port: 587, security: "starttls" },
    keepsSent: false,
  },
  {
    id: "web-de",
    name: "WEB.DE",
    methods: ["imap", "pop3"],
    imap: { host: "imap.web.de", port: 993, tls: true },
    pop3: { host: "pop3.web.de", port: 995, tls: true },
    smtp: { host: "smtp.web.de", port: 587, security: "starttls" },
    keepsSent: false,
  },
  {
    id: "other",
    name: "Other provider",
    methods: ["imap", "pop3"],
    imap: { host: "", port: 993, tls: true },
    pop3: { host: "", port: 995, tls: true },
    smtp: { host: "", port: 465, security: "tls" },
    keepsSent: false,
  },
];

export const providerById = (id: string | undefined): MailProvider => MAIL_PROVIDERS.find((p) => p.id === id) ?? MAIL_PROVIDERS[MAIL_PROVIDERS.length - 1];

/** The provider whose incoming server this is ("other" when none). */
export const providerOfHost = (host: string): ProviderId =>
  MAIL_PROVIDERS.find((p) => p.id !== "other" && [p.imap.host, p.pop3.host].includes(host.trim().toLowerCase()))?.id ?? "other";
