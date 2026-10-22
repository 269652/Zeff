import type { JSONContent } from "@tiptap/core";

/**
 * Where the AI's text goes in a page (the editor's ✨ actions: improve, shorter, translate …) — as inline content into the line
 * when it is one paragraph and the selection lies within one line (a paragraph put there would split the line in two), as
 * blocks otherwise. Client-safe, pure.
 */
export function fitAiContent(blocks: JSONContent[], withinOneLine: boolean): JSONContent[] {
  if (withinOneLine && blocks.length === 1 && blocks[0].type === "paragraph") return blocks[0].content ?? [];
  return blocks;
}

/** Text blocks as the editor has them: where each one's text starts (its position + 1) and its text. */
export type TextBlock = { start: number; text: string };

/**
 * Where the selected text is now: the range it was taken from when it still says the same, else the first place in one line
 * that does (the page changed while the AI wrote) — null when it is gone (then nothing is replaced).
 */
export function relocate(original: string, range: { from: number; to: number }, textAt: (from: number, to: number) => string, blocks: TextBlock[]): { from: number; to: number } | null {
  if (!original) return null;
  try {
    if (textAt(range.from, range.to) === original) return range;
  } catch {
    // the range is past the page's end now
  }
  for (const b of blocks) {
    const i = b.text.indexOf(original);
    if (i < 0) continue;
    const at = { from: b.start + i, to: b.start + i + original.length };
    try {
      if (textAt(at.from, at.to) === original) return at;
    } catch {
      // a position that doesn't hold (an inline node before it): looked for further
    }
  }
  return null;
}
