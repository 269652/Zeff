# Open loops

What is still open between you and others, across the sources: promises either way, questions and requests waiting for you,
your questions waiting for an answer, Jira comments addressed to you. The plugin is `loops` (`src/plugins/loops/`, order 171,
off by default, depends on `people`; the closing by the AI and the "since" messages use `timeline` when it is installed).

## Where loops come from

- **Promises (AI)** — the People plugin's commitment claims (`people_claims`, kind `commitment`, `direction` mine/theirs, `due`,
  `done_at`). The extraction (`people/extract.ts`, the `peoplenorm` step) is told to read questions to you, review/approval/
  signature requests and your own unanswered questions as commitments too. Every claim not rejected and at confidence ≥ 0.5 is a
  loop — unconfirmed ones are marked (recall first). Ref: `claim:<id>`.
- **By rule** (`detect.ts`, no AI, the last 21 days, at most 3 per thread) — ref `q:<mail|teams|jira>:<key>`:
  - chats (WhatsApp, Signal) and mail threads: what was asked of you since your last word there (a question mark outside links,
    or a request — `isRequest`), in a group only messages to you; mails only from your people or in Gmail threads you wrote in;
    your own question/request as the last word of a 1:1 chat or thread;
  - Teams: chats to you and person-mentions asking something since your last word; your question as a chat's last word;
  - Jira: comments addressed to you (`addressedTo`: your names, first name, `@handle`, `[~handle]`) or asking on your tickets,
    since your last comment on the ticket (done tickets left out); your question nobody answered.
  You are `myNames()` (People: the name you set, your Jira name, your sent mails' name) plus the Jira usernames of the profile
  that is you. A rule's loop disappears by itself once answered.

## Closing (`close.ts`)

- **By rule, closed** — only where the source leaves no doubt: a promise made in a Jira comment whose ticket is done since; an
  attachment from the right side (you for yours, them for theirs) after a promise to send something (`isSendPromise`).
- **By rule, proposed** — in a chat of the two of you, the right side's later message that answers the promise's question, or
  any thread's message that is about it (`sharesTopic`: two words of substance in common, or one of 8+ letters; names and filler
  left out). Never a "later"/"mach ich" (`isDeferral`), an "ok"/"Ja gerne", or a question back. Where many people talk (a group, a
  channel, a ticket) theirs must be theirs by name and your own words count only as an attachment.
  Checked on snapshots of the real data: "any later reply closes it" closed more than half of the open promises, mostly wrongly.
- **By the AI, proposed** — `closeByAi` after the People extraction (`normalize.ts` → `afterExtraction`, with the LLM plugin;
  task `loops-close`, prompt `loops-close` in the prompt catalog): for up to 15 open promises without a proposal, the timeline's
  messages concerning the person since (mail, message, comment, document, mr; 8 each); the answer names a message and a quote that
  must stand in it.
- **By you** — Done, Not a loop, Confirm, Reopen, Yes kept / No still open (a proposal), Later (off the Today page for 3 days).
  A closing or proposal you took back is remembered (`loops_state.rejected`) and never made again.

The rule closing also runs before a list is read (at most once a minute). A promise closed by its source or the AI gets a
timeline event `loop.closed` (source `loops`).

## State (`state.ts`)

`loops_state(ref, state open|closed|dismissed, closed_by rule|ai|you, close_ref, close_quote, closed_at, proposal_ref,
proposal_quote, proposal_href, proposal_at, proposal_by, rejected json, snooze_until, snapshot json, updated_at)` — made on first
use. Promises keep living in `people_claims` (closing sets `done_at`, the People pages see it); a rule's loop keeps a snapshot once
decided.

## The ledger

Every decision goes to `ai_feedback` (step `open-loops`, `loopFeedback` in `lib/learning/sources.ts`): close/confirm → accepted
(kind `<kind>:<direction>`), dismiss → rejected, reopen after a closing by rule/AI → rejected `close:rule`/`close:ai`, a proposal
accepted/rejected → `close:rule`/`close:ai`. Ticking a commitment off in the People plugin (`reviewClaim(id, "done")`) records the
same accepted row; confirm/dismiss of a promise also records the People claim's own row (`people-claim`).

## Reading

```ts
import { listLoops, findLoop, nudges, loopCounts, mailLoops } from "@/plugins/loops/query";
listLoops({ view: "mine" | "theirs" | "overdue" | "closed", personId, limit })   // overdue first, then due, then newest
import { decideLoop } from "@/plugins/loops/store";   // (ref, "close" | "dismiss" | "confirm" | "reopen" | "accept-close" | "reject-close" | "later")
```

Overdue: its due day passed, or (no day) open for 7 days.

MCP (in "Search what Zeff knows"): `open_loops { direction?: mine|theirs|all, overdue?, closed?, person?, limit? }` — lines
`I owe · promise | Who [person:3] | text | since …, due …, OVERDUE, unconfirmed | “quote” | source sourceRef | href | [ref]`.
Each loop carries its source's data boundary (`lib/boundaries`): a caller sees only what its clearance allows (personal sources
such as WhatsApp only with the permission, secret never); the head line says how many were left out.

## UI

- `/loops` (in the apps): All open / I owe / Owed to me / Overdue / Closed, each loop with its buttons and proposal.
- The person page: the part `person.loops` (above the timeline; nothing when the plugin is off or nothing is open).
- The Today page: "Open loops overdue" — at most 5, yours first, with later/done (it replaces "Commitments due" while installed).
- Chips (`ui/LoopChip.tsx`): on the threads of the Messages page (`/mail`) and on the messages of the WhatsApp app.
