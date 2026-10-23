# Writing to Gmail and Google Calendar

Zeff reads Gmail and Google Calendar through Google's API (the Google sign-in on **Settings → Connections**). It can also
write to both — only when you allow it there, only on your click, and never by deleting anything.

## Turning it on

On **Settings → Connections → Google → What Zeff may do with Google**:

- **Allow writing to Gmail** — asks Google for `gmail.modify` and `gmail.settings.basic` at the next sign-in.
- **Allow writing to Google Calendar** — asks Google for `calendar.events` at the next sign-in.

A switch alone changes nothing: Google holds the right only after you sign in again ("Connect again" under the switch). The
pills above the switches show what the sign-in holds now. Switched off (or not signed in again), everything stays as before:
a mail opens in Gmail's compose window, an appointment in Google Calendar's form, filled in, for you to finish.

## What Zeff writes — and where it starts

| Where you click | What is written |
| --- | --- |
| A todo's mail action (`gmail-compose`): **Send** / **Save as draft in Gmail** | The mail sent from your Gmail (or saved in its drafts). When the todo came from a Gmail mail and the mail goes to its sender (or answers its subject), it is a reply in that conversation: Gmail's thread, `In-Reply-To` and `References` from the thread's last message, the thread's subject. The action leaves the todo and is noted on it; a reply that was the todo ticks it off. |
| A todo's appointment (`gcal-event`): **Add to Google Calendar** (on the todo, or **Accept** in the calendar) | The event in your main Google calendar. |
| An inbox row of a Gmail mail (the mail client's reply): **Send** / **Save as draft in Gmail** | The reply, in the row's conversation. |
| The same row: **Archive** / **Mark unread** | The conversation out of the inbox (still in All Mail) / marked unread — labels only. |
| The calendar app, a Google calendar you own or may write (`owner` / `writer`) | A new event (title, all day or from–to, place, notes, guests — Google invites them), your event moved, resized or edited. Guests are told of a change to your meeting. |
| The calendar app, an invitation: **Accept** / **Maybe** / **Decline** | Your answer only (the others' answers stay); the organiser is told. |

After each calendar write the days it touched are read again from Google, so the calendar shows it at once. Each write is
noted on the timeline (`mail.sent`, `mail.draft`, `calendar.created`, `calendar.changed`, `calendar.response`).

Agents (MCP tools, workers, auto-actions, the todo's **Run**) never send a mail or write an event: they propose — a todo's
action — and it runs on your click. (With "Allow writing to Gmail", an agent whose routine permissions say so may still
change labels, read state, spam and filters, as before.)

## What Zeff never does

- No mail is deleted, trashed or forwarded; no draft is deleted.
- No event is deleted or cancelled, moved to another calendar or cleared; someone else's meeting is not moved (you answer it).
- Nothing is written to a calendar you may only read.

All writes go through one guard (`src/lib/google/write-guard.ts`): an allowlist of methods and paths (send, drafts, drafts/send,
message/thread modify, batchModify, labels, filters; events insert and patch). It refuses any `DELETE`, any `/trash` path,
a `TRASH` label, forwarding and `status: "cancelled"`. `tests/google-writes.test.ts` holds the modules to it, and
`tests/safety.test.ts` holds every write to its click paths.

## Code

- `src/lib/google/gmail-send.ts` — MIME (UTF-8, encoded headers), send, drafts, archive, unread.
- `src/lib/google/calendar-write.ts` — insert, patch, respond, the writable-calendar check, the read-back.
- `src/lib/google/grants.ts` — what the pages are told (`gmail-send`, `gcal-write`; `useGrant()` on the client).
- `src/plugins/gmail/run.ts`, `src/plugins/google-calendar/run.ts` — the actions on a click (not in `RUNNERS`).
