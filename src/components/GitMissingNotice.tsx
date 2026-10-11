import { gitAvailable, gitMissingMessage } from "@/lib/git";

/** A line at the top of the pages that need git (Work, Repos) when this PC has none — says what to install. Nothing otherwise. */
export function GitMissingNotice() {
  if (gitAvailable()) return null;
  return <p className="m-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">{gitMissingMessage()}</p>;
}
