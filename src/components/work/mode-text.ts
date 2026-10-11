import type { T } from "@/lib/i18n/shared";
import type { ClaudeMode } from "@/lib/work/shared";

/**
 * A Claude session mode's name and what it does, translated — literal keys, so `npm run i18n`
 * finds them (CLAUDE_MODE_INFO holds the same English for the server side).
 */
export function modeText(t: T, m: ClaudeMode): { label: string; hint: string } {
  switch (m) {
    case "default":
      return { label: t("Ask"), hint: t("Reads freely; asks you before every edit and every command that isn't allowed yet.") };
    case "acceptEdits":
      return { label: t("Edits"), hint: t("File edits without asking; commands still ask.") };
    case "auto":
      return { label: t("Auto"), hint: t("Claude's classifier allows what's safe and asks you only when it would block — runs on its own, you step in when needed.") };
    case "plan":
      return { label: t("Plan"), hint: t("Looks around and plans, changes nothing — you approve the plan, then it carries it out.") };
    case "dontAsk":
      return { label: t("Don't ask"), hint: t("Never asks: what isn't allowed yet is refused. For runs nobody watches.") };
    case "bypassPermissions":
      return { label: t("Bypass"), hint: t("Everything allowed, no checks at all — only where nothing can go wrong (a worktree, a sandbox).") };
  }
}

/** A changed file's state, translated. */
export function fileStatusText(t: T, s: "added" | "modified" | "deleted" | "renamed" | "untracked"): string {
  switch (s) {
    case "added":
      return t("added");
    case "modified":
      return t("modified");
    case "deleted":
      return t("deleted");
    case "renamed":
      return t("renamed");
    case "untracked":
      return t("new");
  }
}
