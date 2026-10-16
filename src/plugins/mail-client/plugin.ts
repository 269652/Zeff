import { definePlugin } from "../define";

/**
 * Mail & Chat: the Workspace's mail client and chat — views for databases of mails (Outlook, Gmail) and of messages (Teams,
 * WhatsApp, Signal) a pipeline keeps. Without it those databases are tables like any.
 */
export default definePlugin({
  id: "mail-client",
  order: 262,
  name: "Mail & Chat",
  description: "Views for the Workspace's mail and message databases: a mail client (folders, list, reading pane) and a chat (conversations, messages, reply). Without it, they show as tables.",
  category: "app",
  defaultInstalled: true,
  dependsOn: ["workspace"],
});
