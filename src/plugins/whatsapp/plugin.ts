import { definePlugin } from "../define";

/** WhatsApp: what it is and what it brings (its manifest). */
export default definePlugin({
  id: "whatsapp",
  order: 280,
  actionsOrder: 80,
  name: "WhatsApp",
  description: "Reads your chats in WhatsApp Web in the account's automation Chrome — only the chat list (per chat the last message, who, when, unread); no chat is opened, so nothing is marked as read (no blue ticks). The messages go into the review (todos), matching and knowledge, just like mails.",
  category: "connector",
  defaultInstalled: false,
  experimental: "Zeff reads WhatsApp Web in the automation Chrome, as if by hand. WhatsApp does not offer an API for this, its terms forbid automated access, and it can restrict or ban an account it suspects of it. A WhatsApp update can stop the sync or make it read wrongly.",
  requires: "The account's automation Chrome with WhatsApp Web (web.whatsapp.com), linked to your phone.",
  apps: [
    { href: "/mail", label: "Inbox", short: "Inbox", hint: "All your mails and chats in one place, a filter per channel" },
  ],
  routes: ["/mail", "/apps/whatsapp", "/api/boards/mail-relations"],
  syncSteps: ["whatsapp", "mailtodos", "relations"],
  services: ["whatsapp"],
  extensions: [
    { key: "send-action", for: "auto-actions", name: "Send message", description: "Auto actions also suggest WhatsApp messages (reply, accept, propose a time) — ready-worded; they're only sent on your click, through WhatsApp Web in the automation Chrome.", defaultInstalled: true, actions: ["whatsapp-message"] },
  ],
});
