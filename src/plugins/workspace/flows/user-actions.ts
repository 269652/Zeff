/**
 * Which of the kernel's flow actions a view may do as you — the way the built-in screens' own buttons act: your click is the yes, so no
 * flow permission is asked. The rest of the flow actions are for flows (automation: they need what they were granted). Client-safe.
 */
/** What a view may do by itself, without a click (<data do="…">): only reading — a conversation, what is unread, Google's write access,
 * the inbox templates, the local AI's settings and what answers at an address — and marking read the mail you looked at for a moment. */
export const AUTO_ACTIONS = new Set(["mail.thread", "mail.unread", "mail.mark-read", "zeff.grants", "mail.inbox-templates", "localai.config", "localai.probe"]);

/** What a button may do (<button do="…">): a reply drafted or sent (confirm= asks first), mails archived or marked read, a field set on
 * rows, a new inbox, the local AI tested and its settings saved — and all a view may do by itself. */
export const USER_ACTIONS = new Set(["mail.thread", "mail.unread", "row.reply.draft", "row.op", "mail.archive", "mail.archive-read", "mail.mark-read", "rows.set", "mail.gmail-change", "zeff.grants", "mail.inbox-templates", "mail.new-inbox", "localai.config", "localai.probe", "localai.test", "localai.save"]);
