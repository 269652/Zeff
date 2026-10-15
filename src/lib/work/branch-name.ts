import type { TodoView } from "@/lib/boards/shared";

/**
 * The pattern for a new branch: the Jira ticket key, then a few words the AGENT picks for the code
 * change it actually makes (feature/PROJ-364-footer-link-indent) — not the todo's or ticket's title,
 * which isn't necessarily the change.
 */
export function newBranchName(t: Pick<TodoView, "ticket" | "kind">): string {
  return `${t.kind === "fix" ? "fix" : "feature"}/${t.ticket}-<short-change>`;
}
