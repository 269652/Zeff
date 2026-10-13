"use server";

import { revalidateAll, type ActionState } from "@/app/action-helpers";
import { t } from "@/lib/i18n/server";

/** Teams (mentions and 1:1 messages, read from Teams in the automation Chrome) — its server actions (each answers an ActionState unless it says otherwise). */

/** "Sync now" on the Teams page: read Teams' own cache in the automation Chrome (read-only; opens Teams there if needed). */
export async function syncTeamsAction(): Promise<ActionState> {
  // Through the Sync menu's step: on the sync host when there is one, stoppable from the menu.
  const { syncAndWait } = await import("@/lib/sync/registry");
  const r = await syncAndWait("teams");
  revalidateAll();
  return r.lastOk ? { ok: true, message: r.lastMessage ?? "" } : { ok: false, error: r.lastMessage ?? t("Failed.") };
}

/** Which of these links point at a synced Teams message — that message, by link (null when none). */
export async function findTeamsMessagesAction(urls: string[]): Promise<Record<string, import("@/lib/teams/shared").TeamsMessageView | null>> {
  if (!Array.isArray(urls)) return {};
  const { teamsLinkKey } = await import("@/lib/teams/shared");
  const { teamsMessagesByKeys } = await import("@/lib/teams/store");
  const list = urls.map(String).slice(0, 50);
  const found = teamsMessagesByKeys(list.map((u) => teamsLinkKey(u) ?? ""));
  return Object.fromEntries(list.map((u) => [u, found.get(teamsLinkKey(u) ?? "") ?? null]));
}

/** The context form's Teams picker: synced messages matching the words, newest first. */
export async function searchTeamsMessagesAction(q: string): Promise<import("@/lib/teams/shared").TeamsMessageView[]> {
  const { listTeamsMessages } = await import("@/lib/teams/store");
  return listTeamsMessages({ q: String(q ?? "").slice(0, 1000), limit: 8 });
}

/** A Teams message marked done (or not): no new todos from it. */
export async function setTeamsResolvedAction(key: string, resolved: boolean): Promise<ActionState> {
  if (!String(key).includes("|")) return { ok: false, error: t("Unknown message.") };
  const { setTeamsResolved } = await import("@/lib/resolved");
  setTeamsResolved(String(key), !!resolved);
  revalidateAll();
  return { ok: true };
}
