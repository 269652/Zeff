import { definePlugin } from "../define";

/** Microsoft Teams: what it is and what it brings (its manifest). */
export default definePlugin({
  id: "teams",
  order: 350,
  actionsOrder: 30,
  name: "Microsoft Teams",
  description: "Reads your mentions and chats in Teams Web — context for the briefing and todos; sends Teams messages on a click.",
  category: "connector",
  defaultInstalled: true,
  requires: "The automation Chrome with Teams Web, signed in — or Microsoft's API with your own sign-in (Connections page).",
  settings: { href: "/settings/connections", what: "How it is reached: the automation Chrome or its API" },
  apps: [
    { href: "/mail", label: "Inbox", short: "Inbox", hint: "All your mails and chats in one place, a filter per channel" },
  ],
  routes: ["/teams", "/mail"],
  syncSteps: ["teams"],
  services: ["teams"],
});
