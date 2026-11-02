import { redirect } from "@/lib/redirect";
import { connection } from "next/server";
import { isInstalled } from "@/plugins/state";

/**
 * The Notes and Keep plugins are gone — your Keep boards are Workspace databases, Google Keep is the Workspace's Keep
 * source. Old links lead there: a board (/keep/3) to the database it became, /keep/google to Google Keep's database,
 * /keep/settings to the data sources, anything else to the Workspace.
 */
export default async function KeepRedirect({ params }: { params: Promise<{ rest?: string[] }> }) {
  await connection();
  const [first] = (await params).rest ?? [];
  if (first && /^\d+$/.test(first)) {
    const moved = (await import("@/plugins/workspace/legacy/keep")).movedKeepHref(Number(first));
    if (moved) redirect(moved);
  }
  if (first === "google" && isInstalled("keep")) {
    const g = await import("@/plugins/keep/google-workspace");
    if (!g.googleKeepHref() && (await import("@/plugins/keep/store")).keepCount() > 0) g.syncGoogleKeepDatabase();
    const href = g.googleKeepHref();
    if (href) redirect(href);
  }
  if (first === "settings" || first === "google") redirect("/workspace/settings/sources");
  redirect("/workspace");
}
