import { MAIL_FOLLOWERS, MAIL_INTERVAL } from "@/lib/mail/sync-settings";
import type { PluginSyncSettings } from "../sync-settings";

/** The IMAP mailbox's part of the Sync settings: the mail sync (shared with Outlook Mail and Gmail) and what goes through the mails. */
export const syncSettings: PluginSyncSettings = { intervals: [MAIL_INTERVAL], follows: MAIL_FOLLOWERS };
