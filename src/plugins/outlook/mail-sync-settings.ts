import { MAIL_FOLLOWERS, MAIL_INTERVAL } from "@/lib/mail/sync-settings";
import type { PluginSyncSettings } from "../sync-settings";

/** Outlook Mail's part of the Sync settings: the mail sync (shared with Gmail) and what goes through the mails. */
export const syncSettings: PluginSyncSettings = { intervals: [MAIL_INTERVAL], follows: MAIL_FOLLOWERS };
