/**
 * Tag helpers with no server-only imports, safe to use from client components.
 */
export type TagLite = { id: number; name: string; color: string | null };

// Regex literals (not `new RegExp(string)`) so the \p and \s escapes are literal.
// Tags start with a letter so hex colors like "#000" are not captured.
const HASHTAG_RE = /(^|\s)#(\p{L}[\p{L}0-9_-]*)/gu;
/** A #tag currently being typed at the caret, e.g. "…text #te|". */
const TRAILING_HASHTAG_RE = /(?:^|\s)#(\p{L}[\p{L}0-9_-]*)?$/u;

export function normalizeTagName(raw: string): string {
  return raw.trim().replace(/^#+/, "").replace(/\s+/g, "-").slice(0, 40);
}

/** Pull `#tags` out of text: returns the cleaned text and the tag names found. */
export function extractHashtags(input: string): { text: string; tags: string[] } {
  const tags: string[] = [];
  const text = input
    .replace(HASHTAG_RE, (_m, pre: string, tag: string) => {
      tags.push(tag);
      return pre;
    })
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  return { text, tags: dedupeTags(tags) };
}

/** Case-insensitive de-dupe, keeping the first spelling of each tag. */
export function dedupeTags(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of names) {
    const key = n.toLowerCase();
    if (n && !seen.has(key)) {
      seen.add(key);
      out.push(n);
    }
  }
  return out;
}

/**
 * If the caret (at `caret` in `text`) sits right after a `#partial`, return the
 * partial word and the index where the `#` starts; else null. Drives the popup.
 */
export function hashtagAtCaret(text: string, caret: number): { text: string; start: number } | null {
  const before = text.slice(0, caret);
  const m = TRAILING_HASHTAG_RE.exec(before);
  if (!m) return null;
  const query = m[1] ?? "";
  const start = before.length - (query.length + 1); // include the '#'
  return { text: query, start };
}

/** Default tags by job number, project id and ticket key (upper-case) — see default-tags.ts. */
export type DefaultTagMaps = {
  jobs: Record<string, string[]>;
  projects: Record<number, string[]>;
  tickets: Record<string, string[]>;
};

/** The default tags for a booking: its job's, its project's and its (complete) ticket's. */
export function pickDefaultTags(
  maps: DefaultTagMaps,
  sel: { jobNumber?: string | null; projectId?: number | null; ticket?: string | null },
): string[] {
  const ticket = sel.ticket?.trim().toUpperCase();
  return dedupeTags([
    ...((sel.jobNumber && maps.jobs[sel.jobNumber]) || []),
    ...((sel.projectId && maps.projects[sel.projectId]) || []),
    ...((ticket && maps.tickets[ticket]) || []),
  ]);
}
