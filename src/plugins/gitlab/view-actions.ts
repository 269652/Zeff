"use server";

import { t } from "@/lib/i18n/server";

/**
 * What GitLab's app view in the Workspace shows besides its rows (view-template.meta.ts): what it reads and from where, the sync and how it
 * last went, the Jira projects you book (a ticket in a title or branch), the items as "Add as context" needs them — as GitLab's own page had it.
 */
export async function gitlabScreenAction() {
  const { getConnector } = await import("@/lib/connectors/store");
  const { getGitlabSettings, listGitlabItems } = await import("@/lib/gitlab/store");
  const { agoText } = await import("@/lib/teams/time");
  const { getEntryTicketSuggestions } = await import("@/lib/ticket-suggestions");
  const { currentWeek } = await import("@/lib/week");
  const settings = getGitlabSettings();
  const host = (() => {
    try {
      return new URL(settings.baseUrl).host;
    } catch {
      return settings.baseUrl;
    }
  })();
  const intro =
    getConnector("gitlab").driver === "api"
      ? t("Merge requests you wrote, are assigned to or review, their comments (yours too), and your branches — read from {host} through its API. Add them to an entry with its context search (a pasted link works too), or add one as context here.", { host })
      : t("Merge requests you wrote, are assigned to or review, their comments (yours too), and your branches — read from {host} in the automation Chrome (GET requests only: nothing changes in GitLab). Add them to an entry with its context search (a pasted link works too), or add one as context here.", { host });
  return {
    intro,
    host,
    syncMinutes: settings.syncMinutes,
    last: settings.lastSyncAt ? { at: settings.lastSyncAt, ago: agoText(settings.lastSyncAt), ok: !!settings.lastOk, result: settings.lastResult ?? "" } : null,
    prefixes: [...new Set(getEntryTicketSuggestions(currentWeek()).map((s) => s.ticket.split("-")[0].toUpperCase()))],
    // (By key: what "Add as context" and resolving a comment need of an item.)
    items: Object.fromEntries(listGitlabItems({ limit: 500 }).map((i) => [i.key, i])),
    nothing: t("Nothing synced yet — press Sync now ({host} opens in the automation Chrome if it isn't).", { host }),
  };
}

export type GitlabScreen = Awaited<ReturnType<typeof gitlabScreenAction>>;
