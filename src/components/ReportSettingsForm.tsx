"use client";

import { useActionState } from "react";
import { saveReportSettingsAction, type ActionState } from "@/app/actions";
import type { ReportSettings } from "@/db/schema";
import { SubmitButton } from "./SubmitButton";

export function ReportSettingsForm({ settings }: { settings: ReportSettings }) {
  const [state, action] = useActionState<ActionState, FormData>(saveReportSettingsAction, null);
  return (
    <form action={action} className="space-y-3">
      <div className="max-w-xs">
        <label className="label" htmlFor="groupBy">Group entries by</label>
        <select id="groupBy" name="groupBy" className="input" defaultValue={settings.groupBy}>
          <option value="ticket">Ticket &amp; meeting (default)</option>
          <option value="type">Type (Tickets / Meetings / Other)</option>
          <option value="tag">Tag (#tag, then ticket/meeting)</option>
        </select>
        <p className="mt-1 text-xs text-zinc-500">
          The options below apply to the <em>Ticket &amp; meeting</em> grouping (and the untagged
          fallback of <em>Tag</em> grouping).
        </p>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="groupMeetingsByDay" defaultChecked={settings.groupMeetingsByDay} className="size-4 accent-indigo-600" />
        Group all meetings on a day into one line
      </label>
      <div className="max-w-xs">
        <label className="label" htmlFor="meetingsLabel">Meetings label</label>
        <input id="meetingsLabel" name="meetingsLabel" className="input" defaultValue={settings.meetingsLabel} />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="groupTicketsByDay" defaultChecked={settings.groupTicketsByDay} className="size-4 accent-indigo-600" />
        Merge same-ticket entries on a day into one line
      </label>
      <div className="max-w-md">
        <label className="label" htmlFor="ticketTemplate">Ticket line template</label>
        <input id="ticketTemplate" name="ticketTemplate" className="input font-mono" defaultValue={settings.ticketTemplate} />
        <p className="mt-1 text-xs text-zinc-500">
          Use <code className="code">{"{ticket}"}</code> and <code className="code">{"{description}"}</code>, e.g.{" "}
          <code className="code">{"{ticket}: {description}"}</code> → <em>PROJ-80: Umsetzung des Testfeedbacks</em>.
        </p>
      </div>
      <div className="flex items-center gap-3">
        <SubmitButton className="btn btn-primary" pendingText="Saving…">Save report settings</SubmitButton>
        {state?.error && <span className="text-sm text-red-600 dark:text-red-400">{state.error}</span>}
        {state?.ok && state.message && <span className="text-sm text-emerald-600 dark:text-emerald-400">{state.message}</span>}
      </div>
    </form>
  );
}
