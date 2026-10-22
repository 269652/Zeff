"use client";

import { useNoAppData, type PartProps, type ViewAppModule } from "@/plugins/workspace/ui/app-view";
import ChatView from "./ChatView";
import InboxView from "./InboxView";
import MailView from "./MailView";

/** The mail client's views, client side: the parts their templates are built of. */
export const MAIL: ViewAppModule = { parts: { "mail.view": (p: PartProps) => <MailView {...p} /> }, useAppData: useNoAppData };
export const CHAT: ViewAppModule = { parts: { "chat.view": (p: PartProps) => <ChatView {...p} /> }, useAppData: useNoAppData };
export const INBOX: ViewAppModule = { parts: { "inbox.view": (p: PartProps) => <InboxView {...p} /> }, useAppData: useNoAppData };
