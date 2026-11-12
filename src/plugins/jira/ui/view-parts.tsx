"use client";

import { useCallback, useEffect, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { JiraJobSelect } from "@/components/JiraJobSelect";
import { JiraSyncControls } from "@/components/JiraSyncControls";
import { SubmitButton } from "@/components/SubmitButton";
import { TicketTagsEditor } from "@/components/TicketTagsEditor";
import type { AppViewProps, PartProps, ViewAppModule } from "@/plugins/workspace/ui/app-view";
import { clearJiraAction } from "../server-actions";
import { jiraScreenAction, type JiraScreen } from "../view-actions";

/** Jira's app view, client side: what its template reads as app.* (view-actions.ts) and the parts where it takes more than the language's tags. */

function useJiraData(props: AppViewProps) {
  const [data, setData] = useState<JiraScreen | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    void jiraScreenAction().then((d) => live && setData(d));
    return () => {
      live = false;
    };
    // (Read again when the rows change: a sync, a job set.)
  }, [tick, props.rows.length]);
  return { data: (data ?? {}) as Record<string, unknown>, reload: useCallback(() => setTick((x) => x + 1), []) };
}

const screen = (p: PartProps): JiraScreen | null => (p.app.tickets ? (p.app as JiraScreen) : null);
/** The ticket key of the row the part stands in. */
const keyOf = (p: PartProps) => String(p.rows.find((r) => r.id === p.rowId)?.cells.jkey ?? "");

function Sync(p: PartProps) {
  const s = screen(p);
  return s ? <JiraSyncControls configured={s.configured} ui={{}} /> : null;
}

function Clear(p: PartProps) {
  const t = useT();
  if (!p.rows.length) return null;
  return (
    <form action={clearJiraAction}>
      <SubmitButton className="btn btn-sm btn-danger" pendingText="…" confirm={t("Delete all synced tickets?")}>
        {t("Clear")}
      </SubmitButton>
    </form>
  );
}

function Job(p: PartProps) {
  const s = screen(p);
  const key = keyOf(p);
  const tk = s?.tickets[key];
  return tk ? <JiraJobSelect ticketKey={key} jobs={s.jobs} current={tk.job} boardJob={tk.boardJob} /> : null;
}

function Tags(p: PartProps) {
  const s = screen(p);
  const key = keyOf(p);
  const tk = s?.tickets[key];
  return tk ? <TicketTagsEditor ticketKey={key} tags={tk.tags} allTags={s.allTags} /> : null;
}

const JIRA: ViewAppModule = {
  parts: { "jira.sync": Sync, "jira.clear": Clear, "jira.job": Job, "jira.tags": Tags },
  useAppData: useJiraData,
};
export default JIRA;
