"use server";

import { pluginAction } from "@/lib/action-result";
import { t } from "@/lib/i18n/server";

/** The tree's badges read again (after a change) — without drawing the page anew. */
const run = pluginAction("workspace", () => t("The Workspace plugin is not installed (Menu → Plugins)."));

export async function pageBadgesAction() {
  return run(async () => ({ badges: await (await import("./badges")).pageBadges({ wait: 4000 }) }));
}
