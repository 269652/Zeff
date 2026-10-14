import { definePlugin } from "../define";

/** Signal: what it is and what it brings (its manifest). */
export default definePlugin({
  id: "signal",
  order: 290,
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
    { key: "send-action", for: "auto-actions", name: "Send message", description: "Auto actions also suggest Signal messages (reply, accept, propose a time) — ready-worded; they are only sent on your click, through Signal Desktop.", defaultInstalled: true, actions: ["signal-message"] },
  ],
});
