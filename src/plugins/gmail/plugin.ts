import { definePlugin } from "../define";

/** Gmail: what it is and what it brings (its manifest). */
export default definePlugin({
  id: "gmail",
  order: 270,
  actionsOrder: 100,
  name: "Gmail",
  description: "Reads your Gmail inbox in the account's automation Chrome (only the list, nothing is opened or marked as read) — mails as context for todos, the mail review, mail matching and knowledge; with or instead of Outlook.",
  category: "connector",
  defaultInstalled: false,
  requires: "The account's automation Chrome with Gmail (mail.google.com), signed in — or Google's API with your own sign-in (Connections page).",
  settings: { href: "/settings/mail", what: "Mail accounts: add one, its servers, password and folders" },
  apps: [
    { href: "/mail", label: "Inbox", short: "Inbox", hint: "All your mails and chats in one place, a filter per channel" },
  ],
  routes: ["/mail", "/apps/gmail", "/gmail", "/api/boards/mail-relations"],
  syncSteps: ["mail", "mailtodos", "relations"],
  services: ["gmail"],
  extensions: [
    { key: "compose-action", for: "auto-actions", name: "Write mail", description: "Auto actions also suggest mails (reply, ask, submit) — one click opens Gmail's draft, filled in; you send it yourself.", defaultInstalled: true, actions: ["gmail-compose"] },
  ],
});
