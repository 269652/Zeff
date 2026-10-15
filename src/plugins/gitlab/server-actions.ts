"use server";

import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { revalidateAll, str, type ActionState } from "@/app/action-helpers";

/** GitLab (merge requests, their comments, your branches — read through the automation Chrome) — its server actions (each answers an ActionState unless it says otherwise). */

/** "Sync now" on the GitLab page: GET requests to GitLab's API from a GitLab tab in the automation Chrome (opens one if needed). */
export async function syncGitlabAction(): Promise<ActionState> {
  // Through the Sync menu's step: on the sync host when there is one, stoppable from the menu.
  const { syncAndWait } = await import("@/lib/sync/registry");
  const r = await syncAndWait("gitlab");
  revalidateAll();
  return r.lastOk ? { ok: true, message: r.lastMessage ?? "" } : { ok: false, error: r.lastMessage ?? t("Failed.") };
}

/** Your GitLab's address (how often it syncs: the Sync settings page). */
export async function saveGitlabSyncAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const base = (str(fd, "baseUrl") ?? "").replace(/\/+$/, "");
  if (!/^https?:\/\/[^/\s]+$/.test(base)) return { ok: false, error: t("Your GitLab's address, like https://git.example.com") };
  const { updateGitlabSettings } = await import("@/lib/gitlab/store");
  updateGitlabSettings({ baseUrl: base });
  revalidateAll();
  return { ok: true, message: t("Reads {host}.", { host: new URL(base).host }) };
}

/**
 * A GitLab comment marked done (or open again): a thread GitLab resolves is resolved (reopened)
 * there too — through its API in the automation Chrome; either way no new todos from it.
 */
export async function setGitlabResolvedAction(key: string, resolved: boolean): Promise<ActionState> {
  try {
    if (!/^note:\d+$/.test(String(key))) return { ok: false, error: t("Only GitLab comments can be marked done.") };
    const { gitlabItemsByKeys, setGitlabState } = await import("@/lib/gitlab/store");
    const item = gitlabItemsByKeys([String(key)]).get(String(key));
    if (item && (item.state === "resolved" || item.state === "unresolved")) {
      const { resolveGitlabThread } = await import("@/lib/gitlab/reply");
      const r = await resolveGitlabThread(item.url, !!resolved);
      if (r.resolvable) setGitlabState(String(key), resolved ? "resolved" : "unresolved");
    }
    const { setGitlabResolved } = await import("@/lib/resolved");
    setGitlabResolved(String(key), !!resolved);
    revalidateAll();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `GitLab: ${errorMessage(err)}` };
  }
}

/** The context form's GitLab picker: synced items matching the words, most recently updated first. */
export async function searchGitlabItemsAction(q: string): Promise<import("@/lib/gitlab/shared").GitlabItemView[]> {
  const { listGitlabItems } = await import("@/lib/gitlab/store");
  const { gitlabLinkKey } = await import("@/lib/gitlab/shared");
  const text = String(q ?? "").slice(0, 1000);
  // A pasted link: what it points at, with its merge request's comments.
  if (gitlabLinkKey(text)) return listGitlabItems({ q: text, limit: 12 });
  // Words: the best of each kind, so none crowds out the others — comments, what people wrote,
  // first; for a merge request's number ("!167") the merge request.
  const comments = listGitlabItems({ q: text, kind: "comment", limit: 12 });
  const mrs = listGitlabItems({ q: text, kind: "mr", limit: 5 });
  const branches = listGitlabItems({ q: text, kind: "branch", limit: 3 });
  return /^!\d+$/.test(text.trim()) ? [...mrs, ...comments, ...branches] : [...comments, ...mrs, ...branches];
}

/** Which of these links point at a synced GitLab item — that item, by link (null when none). */
export async function findGitlabItemsAction(urls: string[]): Promise<Record<string, import("@/lib/gitlab/shared").GitlabItemView | null>> {
  if (!Array.isArray(urls)) return {};
  const { gitlabLinkKey } = await import("@/lib/gitlab/shared");
  const { gitlabItemsByKeys } = await import("@/lib/gitlab/store");
  const list = urls.map(String).slice(0, 50);
  const found = gitlabItemsByKeys(list.map((u) => gitlabLinkKey(u) ?? ""));
  return Object.fromEntries(list.map((u) => [u, found.get(gitlabLinkKey(u) ?? "") ?? null]));
}

/** How Zeff reaches GitLab: through the automation Chrome, or through GitLab's API (a token, or an OAuth client of your own). A secret only when one is typed (else the saved one stays). */
export async function saveGitlabConnectionAction(v: { driver: string; authKind: string; token?: string; clientId?: string; clientSecret?: string }): Promise<ActionState> {
  try {
    const { getConnector, updateConnector, disconnectConnector } = await import("@/lib/connectors/store");
    const row = getConnector("gitlab");
    const driver = v.driver === "api" ? "api" : "cdp";
    const authKind = v.authKind === "oauth" ? "oauth" : "token";
    const token = String(v.token ?? "").trim();
    const clientId = String(v.clientId ?? "").trim();
    const secret = String(v.clientSecret ?? "").trim();
    // Another way of signing in, or another client: the old sign-in doesn't apply.
    if (authKind !== row.authKind || (authKind === "oauth" && (clientId !== row.clientId || (secret !== "" && secret !== row.clientSecret)))) disconnectConnector("gitlab");
    updateConnector("gitlab", {
      driver,
      authKind,
      ...(token ? { token } : {}),
      ...(authKind === "oauth" ? { clientId, ...(secret ? { clientSecret: secret } : {}) } : {}),
    });
    revalidateAll();
    return { ok: true, message: driver === "api" ? t("GitLab is read through its API now.") : t("GitLab is read through the automation Chrome.") };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** The API sign-in forgotten (the token, the OAuth tokens). */
export async function disconnectGitlabAction(): Promise<ActionState> {
  try {
    (await import("@/lib/connectors/store")).disconnectConnector("gitlab");
    revalidateAll();
    return { ok: true, message: t("Disconnected.") };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** A read of the signed-in user through the API: tests the token (or the OAuth sign-in) and shows who it is. */
export async function testGitlabApiAction(): Promise<ActionState> {
  try {
    const { whoAmI } = await import("@/lib/gitlab/api");
    const me = await whoAmI();
    (await import("@/lib/connectors/store")).updateConnector("gitlab", { account: me.username });
    revalidateAll();
    return { ok: true, message: t("Signed in to GitLab as {name} (@{username}).", { name: me.name, username: me.username }) };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
