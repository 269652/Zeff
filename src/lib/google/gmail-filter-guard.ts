/**
 * What a Gmail filter may be made of. A filter works for every mail that comes from now on, so it has to name something that stays — a
 * sender, a recipient, a mailing list, a subject, words — and not only a state of the moment ("important", "unread", "in the inbox") or a
 * stretch of dates (a date range is how an old cleanup is sliced, and a filter with an open end then swallows the mail of the future).
 * For the mails there now there is "change mails"; a filter is for the rule. Returns what is wrong, or null.
 */
export function filterProblem(c: { from?: string; to?: string; subject?: string; query?: string; hasAttachment?: boolean }): string | null {
  // (Mail with an attachment is a kind that stays — "everything with an attachment into Documents" is a rule.)
  if ([c.from, c.to, c.subject].some((x) => !!x?.trim()) || c.hasAttachment) return null;
  const q = (c.query ?? "").trim();
  // Operators that name something lasting: a sender, a recipient, a list, a subject, a mail kind (has:…, filename:…, label:…), a quoted phrase or a plain word.
  const lasting = q
    .split(/\s+/)
    .filter(Boolean)
    .some((tok) => {
      if (/^-/.test(tok)) return false; // a negation names what it is not
      if (/^(is|in|after|before|older|newer|older_than|newer_than|smaller|larger|size|category):/i.test(tok)) return false; // states and ranges of the moment
      return true; // from:, to:, list:, subject:, deliveredto:, has:, filename:, a word …
    });
  if (lasting) return null;
  return q
    ? "This filter would match only a state of the moment (important, unread, in the inbox, a date range) — and a filter keeps working for every mail that comes. Name a sender, a list, a subject or words that stay. To tidy mails that are there already use gmail_change (labels, read, spam) on them — no filter."
    : "A filter needs something to match: a sender, a recipient, a subject or words.";
}
