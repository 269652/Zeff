/**
 * A conflict of a plugin's update merged by the AI: the version installed (base), the one changed here (mine) and the new one (theirs) —
 * one text back that keeps what each side meant. A proposal: the person sees it in the editor and takes it, changes it or leaves it.
 * Needs the LLM plugin. Server only.
 */

export async function aiMerge(file: string, base: string | null, mine: string | null, theirs: string | null): Promise<{ text: string; note: string }> {
  const { isInstalled } = await import("@/plugins/state");
  if (!isInstalled("llm")) throw new Error("The LLM plugin is needed for this (Menu → Plugins).");
  const { runAi } = await import("@/lib/ai");
  const block = (label: string, s: string | null) => `--- ${label} ---\n${s === null ? "(the file is not there)" : s}\n--- end of ${label} ---`;
  const prompt = [
    `Merge three versions of the file "${file}" of a Zeff plugin, the way a careful developer resolves a git merge conflict.`,
    "BASE is the version that was installed. MINE is how the user changed it here. THEIRS is the new version published in the plugin's repository.",
    "Keep every change the user made in MINE and every change THEIRS brings; where both changed the same place, combine them so that both intentions survive. If they truly exclude each other, prefer the user's change and say so in the note.",
    "Answer with the whole merged file in `text` — exactly the file's content, no markdown fences, no conflict markers — and one or two plain sentences in `note` saying what you combined and what you had to decide.",
    "",
    block("BASE", base),
    block("MINE", mine),
    block("THEIRS", theirs),
  ].join("\n");
  const r = await runAi<{ text?: string; note?: string }>(prompt, { type: "object", properties: { text: { type: "string" }, note: { type: "string" } }, required: ["text", "note"] }, { task: "editor-ai", timeoutMs: 4 * 60_000, maxBudgetUsd: 0.5 });
  const out = (r.output ?? {}) as { text?: string; note?: string };
  if (typeof out.text !== "string") throw new Error("The AI gave no merged text.");
  if (/^(<{7}|={7}|>{7})/m.test(out.text)) throw new Error("The AI left conflict markers in — try again, or settle it yourself.");
  return { text: out.text, note: String(out.note ?? "") };
}
