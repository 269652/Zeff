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
  requires: "The account's automation Chrome with WhatsApp Web (web.whatsapp.com), linked to your phone.",
  apps: [
    { href: "/apps/whatsapp", label: "WhatsApp", short: "WhatsApp", hint: "Your chats, their latest messages" },
    { href: "/mail", label: "Messages", short: "Msgs", hint: "All mails and chats in one place, their sync" },
  ],
  routes: ["/mail", "/apps/whatsapp", "/api/boards/mail-relations"],
  syncSteps: ["whatsapp", "mailtodos", "relations"],
  services: ["whatsapp"],
  extensions: [
    { key: "send-action", for: "auto-actions", name: "Send message", description: "Auto actions also suggest WhatsApp messages (reply, accept, propose a time) — ready-worded; they're only sent on your click, through WhatsApp Web in the automation Chrome.", defaultInstalled: true, actions: ["whatsapp-message"] },
  ],
});
