import { definePlugin } from "../define";

/** Outlook Mail: what it is and what it brings (its manifest). */
export default definePlugin({
  id: "outlook-mail",
  order: 260,
  name: "Outlook Mail",
  description: "Reads your inbox in Outlook Web (only the list, nothing is opened) — mails as context for todos, the mail review and mail matching.",
  category: "connector",
  defaultInstalled: true,
  requires: "The automation Chrome with Outlook Web, signed in.",
  settings: { href: "/mail", what: "Which Outlook folders are read" },
  apps: [
    { href: "/mail", label: "Messages", short: "Msgs", hint: "All mails and chats in one place, their sync" },
  ],
  routes: ["/mail", "/api/boards/mail-relations"],
  syncSteps: ["mail", "mailtodos", "relations"],
  services: ["outlook"],
});
