import type { ViewAppMeta } from "@/plugins/workspace/view-apps";

/** The mail client's views as templates (the Workspace's view templates): mail, chat, inbox — their parts, defaults. Client-safe. */
export const MAIL_VIEW: ViewAppMeta = {
  app: "mail",
  label: "Mail",
  parts: [{ name: "mail.view", description: "The whole mail client as before (list, reading pane, reply)" }],
  actions: [],
  appData: "",
  defaultTemplate: () => '<part name="mail.view"/>',
};
export const CHAT_VIEW: ViewAppMeta = {
  app: "chat",
  label: "Chat",
  parts: [{ name: "chat.view", description: "The whole chat as before (conversations, the conversation, reply)" }],
  actions: [],
  appData: "",
  defaultTemplate: () => '<part name="chat.view"/>',
};
export const INBOX_VIEW: ViewAppMeta = {
  app: "inbox",
  label: "Inbox",
  parts: [{ name: "inbox.view", description: "The whole inbox as before (channels, threads, reading pane, reply, snooze)" }],
  actions: [],
  appData: "",
  defaultTemplate: () => '<part name="inbox.view"/>',
};
