import type { AiMode } from "./actions";

/**
 * The page's one ✨ entry (ui/ai-composer.tsx): a text field and three chips — Think along (assist.ts), Write (the editor's AI
 * modes, aiTextAction) and Ask about this page (the workspace chat, agent.ts). KISS: the chip decides; typed text with a chip is
 * that chip's; typed text alone is a question; nothing typed and no chip thinks along. Client-safe.
 */

export type AiChip = "think" | "write" | "ask";
/** The Write chip's modes when nothing is typed (typed text is written as told: "custom"). */
export type WriteMode = Exclude<AiMode, "custom">;
export type AiRoute = { kind: "think"; wish: string } | { kind: "write"; mode: AiMode; instruction?: string } | { kind: "ask"; question: string };

export function routeAiEntry(text: string, chip: AiChip | null, writeMode: WriteMode = "continue"): AiRoute | null {
  const v = text.trim();
  if (chip === "think" || (!chip && !v)) return { kind: "think", wish: v };
  if (chip === "write") return v ? { kind: "write", mode: "custom", instruction: v } : { kind: "write", mode: writeMode };
  return v ? { kind: "ask", question: v } : null;
}

/** An answer this long (or this many lines) is read in the chat panel, not in the composer. */
export const ANSWER_INLINE_MAX = 600;
export const answerFits = (reply: string): boolean => reply.length <= ANSWER_INLINE_MAX && reply.split("\n").length <= 8;
