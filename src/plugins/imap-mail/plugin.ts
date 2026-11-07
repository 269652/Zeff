import { definePlugin } from "../define";

/** E-Mail accounts (IMAP / POP3): what it is and what it brings (its manifest). Installed by Settings → E-Mail when such an account is added. */
export default definePlugin({
  id: "imap-mail",
  order: 275,
  actionsOrder: 105,
  name: "E-Mail (IMAP / POP3)",
  description:
    "Mail accounts read like a mail program — over IMAP or POP3, several side by side (T-Online, GMX, WEB.DE, Gmail, Outlook and any other): their mails are read with the others (the inbox, the mail review, the knowledge; nothing is marked as read or deleted), and you reply or write new mails from Zeff — really sent over the account's SMTP server.",
  category: "connector",
  defaultInstalled: false,
  requires: "Your mailbox's address and its password for mail programs (T-Online: the separate e-mail password), and the provider's IMAP and SMTP servers — filled in for T-Online, GMX and WEB.DE.",
  settings: { href: "/settings/mail", what: "Mail accounts: add one, its servers, password and folders" },
  apps: [{ href: "/mail", label: "Inbox", short: "Inbox", hint: "All your mails and chats in one place, a filter per channel" }],
  routes: ["/settings/mail", "/mail", "/api/boards/mail-relations"],
  syncSteps: ["mail", "mailtodos", "relations"],
});
