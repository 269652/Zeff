# Cases

> One place per matter: the case numbers (Aktenzeichen) in your mails, letters and todos hold together what belongs to one case — its sources, the other side, what is owed, the next instalment or deadline and where to pay. **Category:** app · **On by default:** yes · **Beta:** no · **Needs:** [Workspace](workspace.md) (the AI summaries need [LLM](llm.md); parties need [People](people.md))

![The Cases database's overview: the bank bar on top, four figure tiles (open in all, due in 30 days, running cases, overdue) and the list of running cases](img/cases-overview.png)

## For users

### What it does

Letters from a court, a tax office, a collection agency or an insurer all carry a reference: "Az. DR II 789/26",
"Kassenzeichen 2026-4471", "Unser Zeichen …". Over months, one matter collects a dozen mails, scanned letters and
todos — and the important facts (how much is still open, when the next instalment is due, to which IBAN) are spread
across all of them.

Cases finds those reference numbers by itself and turns each one into a **case**: one row of the Workspace database
**Cases**, with every mail, letter (document), todo and appointment that mentions the number as its sources, in time
order. With the [LLM](llm.md) plugin, the AI reads the sources and sums the case up: what it is about, who the
creditor is and who collects for them (a bailiff, a collection agency), the whole claim, what is still open, the
instalment, the next payment or deadline, and where to pay (payee, IBAN, BIC, purpose). Every value is checked — an
IBAN by its check digits, a date by its form, an amount by being a number — and what doesn't hold is left empty.

Money is then followed, not guessed: a payment todo you tick off, or a booking on your bank statement that matches,
counts against the case. The open amount goes down, the next due date moves on a month (on the plan's day), and a
case paid off is done. An instalment that is ten days late with nothing paid makes a todo — with the transfer on
it — before the payment plan lapses.

Paying is one click away: each running case (and each payment todo with a known account) gets a **Transfer
(GiroCode)** action that opens Zeff's `/pay` page with a QR code for your banking app. Zeff never sends money; you
scan the code and confirm in your bank.

The demo's sample data has no letters with case numbers, so the demo's Cases database shows the empty overview
("No case running."). A real case starts with a mail such as *"Your annual home contents insurance premium of
€84.20 is due … IBAN DE12 5001 0517 0648 4898 90, reference 2026-4471"* once the reference stands next to a word like
"Az.", "Aktenzeichen", "Kassenzeichen" or "Verfahren", is in a letter, or appears in more than one place.

### Getting started

1. Cases is on by default. If not: **Menu → Plugins → Cases** (it installs the [Workspace](workspace.md) with it).
2. On the next start (or the next briefing) Zeff makes the database **Cases** in the Workspace once — it is in the
   Workspace sidebar with the 📁 icon. If you delete it, it is not made again.
3. Cases reads what other plugins brought in: mails ([Mail](mail-client.md), [Gmail](gmail.md),
   [Outlook](outlook.md), [IMAP](imap-mail.md)), letters ([Documents](documents.md)) and [todos](todos.md). Nothing
   to set up beyond those.
4. For the summaries, switch on [LLM](llm.md) and pick a backend for the AI task **Case summaries** (Settings → AI).
5. Optional: bank bookings — import a statement CSV with [Revolut](revolut.md), or connect your bank through Enable
   Banking (below). The figures overview of all debts lives in [Finances](finances.md).

The old address `/vorgaenge/uebersicht` still works: it redirects to the Finances plugin's *Debts and claims*
database.

### Using it

**The overview.** The Cases database opens on its *Cases* view: the bank bar, four tiles — *Open in all*, *Due in
30 days*, *Running cases*, *Overdue* (red when > 0) — and the running cases, the next due first. Each line shows the
case number, its title (the AI's, else the number) with the creditor and collector, the next step (the amount, the due day and what it
is; overdue in red) and a **Pay** button that unfolds the case's GiroCode, or "No account known".

**A case's page.** Click a case to open its row. Its page (the *Case* row view) shows:

- the case number and the creditor as badges, the status dropdown (*open*, *closed*, *ignored* — "not a case",
  never made again);
- where it stands (the AI's summary) and the money as tiles: total, open, instalment, next due;
- its todos, its mails and letters as cards (newest first, more behind *Show more*);
- beside them: the payment (amount editable, the instalment or what is open to start with) with its GiroCode, what
  the bank shows paid, the parties — **Creditor**, **Collected by**, **Paid to** — each a contact field (pick a
  contact, or add a new person or organisation; the AI's choice never overrides yours), and your note;
- with [Know](knowledge.md) a "what you should know" panel, with [Timeline](timeline.md) the case's history by day;
- the button **Sum up** / **Sum up again** (`case.compile`) to have the AI read the case now.

A closed case comes back by itself when a new source arrives.

**Paying.** *Pay* (on the overview or the case page) or the **Transfer (GiroCode)** action on a todo opens the
GiroCode: recipient, IBAN, BIC, amount and purpose to copy, and the QR code (EPC/GiroCode standard) to scan with your
banking app. On a todo the transfer is a card whose fields you can edit; a wrong IBAN is said, never saved. If no IBAN
is known yet, you type it once and Zeff keeps it with the contact.

![Zeff's /pay page: "Transfer to Hausrat Versicherung" with amount 84,20 and purpose 2026-4471, the GiroCode to scan and each field to copy](img/cases-pay.png)

![The bank bar opened: Import statement (CSV), Debt overview and the bank connection form for Enable Banking](img/cases-bank.png)

**The bank.** The bar above the overview has *Import statement (CSV)* (with [Revolut](revolut.md)), *Debt overview*
(with [Finances](finances.md)) and **🏦 Connect bank**:

1. Make an application at Enable Banking (free for your own accounts, "restricted" mode) and link your bank there.
2. In Zeff, enter the application id, its private key (PEM), the bank (default *Revolut*) and the country (default
   *DE*), save, and click connect: you sign in at your bank once; it sends you back to `/api/bank/callback`, and
   Zeff fetches the bookings right away. Access lasts 90 days.
3. After that, bookings are fetched after each briefing and on *Fetch bookings* — the first time 90 days back, later from a
   week before the last fetch.

Each fetched or imported booking that pays a todo's transfer (the amount and the recipient, account or case number)
ticks that todo off with a note and counts for its case.

### Settings

Cases has no settings page of its own. What you can set:

| Setting | Where | What it changes |
| --- | --- | --- |
| Case status | a case's page | *open* (running), *closed* (done, reopens on a new source), *ignored* (not a case, never made again) |
| Parties (creditor, collector, payee) | a case's page | which contacts the case is with; yours wins over the AI's |
| Money corrections | a case's page / the debts table | your total, open, instalment or due over what the AI read |
| Note | a case's page | kept with the case and given to the AI when it sums up |
| Bank connection (app id, private key, bank, country) | bank bar → *Connect bank* | where bookings are fetched from; kept in this account's prefs (`cases.bank`), the key is never sent to the page |
| AI task *Case summaries* (`cases-compile`) | Settings → AI | backend and model for the summaries; the prompt `cases-compile` is editable under Settings → AI → prompts |

### Tips & limits

- **Detection is by rule, not AI.** A number becomes a case only when it stands next to a case word (Az.,
  Aktenzeichen, Zeichen, Geschäftszeichen, Verfahren, Sache, Vorgang, Akte, Kassenzeichen), is in a letter, or
  appears in two places. Calendar weeks, pages, paragraphs, "Nr 5/26" are never cases. "11 DR II 789/26" and "DR II
  789/26" are the same case (a leading department number is dropped).
- **Privacy.** Detection, payment matching and the GiroCode run locally. Only the summary sends something out: the
  case's sources (subjects and previews of mails, up to 2,500 characters of each letter's text, todos and your note)
  go to the AI backend you chose for *Case summaries* — a local one keeps it on the machine. The bank connection talks
  to `api.enablebanking.com` and your bank.
- **Zeff never pays.** The GiroCode and the transfer action only prepare the payment.
- At most 8 cases are summed up per run, the newest activity first; a case is summed up again only when new sources
  came (or on *Sum up*). A debt you wrote down yourself is never re-summarised.
- An AI summary can be wrong — check the amounts against the letter; your corrections stay over the AI's.

## Technical reference

### Overview

Cases keeps its own tables (`cases`, `case_sources`, `case_parties`, plus the bank tables) and shows them as a
**derived database** of the Workspace: its `CASES_SOURCE` (workspace-source.ts) is a Workspace pipeline source; the
database `Cases` is created once by `ensureCasesDatabase()` with `dataType: "cases"`, the app view *Cases*
(view-template.meta.ts, `CASES_VIEW`) first and the row view *Case* (row-template.meta.ts, `CASE_PAGE`) for its rows.
Both views are Workspace view templates built from the template language's tags plus a few plugin parts
(`cases.bank`, `cases.girocode`, `case.status`, `case.sources`, `case.pay`, `case.contact`, `case.note`,
`case.know`, `case.timeline`).

After each briefing (`lib/runs/run.ts`) the pipeline runs:

```mermaid
flowchart LR
  A[mails · documents · todos] -->|caseRefs + rules| B(detectCases)
  B --> C[(cases / case_sources)]
  C -->|LLM installed| D(compileCases → CaseSummary)
  D --> E(assignParties → People contacts)
  C --> F(attachPayments → bank-transfer ops on todos)
  G[Revolut CSV / Enable Banking] --> H[(bank_transactions)]
  H --> I(matchPayments) --> J[todo settled · ledger allocation]
  J --> K(settleCase: open, nextDue, done)
  C --> L(overdueWarnings: todo after 10 days)
```

Money is kept in the shared ledger (`lib/money/ledger`): a booking, a ticked-off payment todo or a "paid" by hand is
a payment allocated to a case. `settleCase()` recomputes a case's figures from the summary's `base` (what the letters
say) and the allocations since — each instalment-sized payment moves the due a month on (on `installmentDay` when
known), a payment without an instalment pays what is open, all paid makes the case done. It is idempotent and runs on
every ledger change and after each new summary. `todo-paid.ts` registers Cases with the todo settle machinery
(`lib/todos/settle.ts`: finder, settler, undo), so a payment todo ticked off pays its case and re-opening it takes the
payment back.

### Manifest

| Field | Value |
| --- | --- |
| id | `cases` |
| category | `app` |
| order | 175 |
| defaultInstalled | `true` |
| dependsOn | `workspace` |
| routes | `/vorgaenge` (only `/vorgaenge/uebersicht` exists: a redirect to the Finances debts database) |
| settings | none |
| syncSteps | none (runs inside the briefing) |
| features | none |
| actions | `bank-transfer` (*Transfer (GiroCode)*) |
| AI tasks | `cases-compile` (*Case summaries*) |

### Files

| File | What it is |
| --- | --- |
| [plugin.ts](../../src/plugins/cases/plugin.ts) | the manifest |
| [server.ts](../../src/plugins/cases/server.ts) | registers the Workspace source, widgets and metrics; loads `todo-paid` |
| [shared.ts](../../src/plugins/cases/shared.ts) | types `Case`, `CaseSummary`, `CaseSource`, `caseKey()` |
| [store.ts](../../src/plugins/cases/store.ts) | the `cases` / `case_sources` tables, list/get/update, money overrides |
| [detect.ts](../../src/plugins/cases/detect.ts) | finds case numbers in mails, documents and todos (rules, no AI) |
| [compile.ts](../../src/plugins/cases/compile.ts) | the AI summary: prompt, JSON schema, value checks |
| [parties.ts](../../src/plugins/cases/parties.ts) | creditor / collector / payee as People contacts |
| [payments.ts](../../src/plugins/cases/payments.ts) | puts transfer actions on payment todos; where a case pays to |
| [actions.ts](../../src/plugins/cases/actions.ts) | the `bank-transfer` action (GiroCode) |
| [bank.ts](../../src/plugins/cases/bank.ts) | bookings, payment matching, overdue warnings, debt overview |
| [bank-sync.ts](../../src/plugins/cases/bank-sync.ts) | Enable Banking: JWT, sign-in, fetching bookings |
| [todo-paid.ts](../../src/plugins/cases/todo-paid.ts) | a payment todo done pays its case; `settleCase()` |
| [database.ts](../../src/plugins/cases/database.ts) | creates/finds the Cases database, row ↔ case |
| [workspace-source.ts](../../src/plugins/cases/workspace-source.ts) | `CASES_SOURCE` and its fixed field ids `CASE_FIELDS` |
| [blocks.ts](../../src/plugins/cases/blocks.ts) / [block-actions.ts](../../src/plugins/cases/block-actions.ts) | the case page's bundle and operations; overview and bank server actions |
| [view-template.meta.ts](../../src/plugins/cases/view-template.meta.ts) / [view-data.ts](../../src/plugins/cases/view-data.ts) | the overview template and its `app.*` data |
| [row-template.meta.ts](../../src/plugins/cases/row-template.meta.ts) | the case page template |
| [widgets.ts](../../src/plugins/cases/widgets.ts) | Workspace widgets `cases.figures`, `cases.due`, `cases.open` |
| [metrics.ts](../../src/plugins/cases/metrics.ts) | Kennzahlen (metrics) |
| [ui/](../../src/plugins/cases/ui/) | `BankBar`, `TransferCard`, `ContactField`, row/view parts |
| [app/pay](../../src/app/pay/page.tsx) | the GiroCode page `/pay` |
| [api/bank/callback](../../src/app/api/bank/callback/route.ts) | where the bank sends you back after signing in |

### Data

| Table / pref | Fields |
| --- | --- |
| `cases` | `id`, `key` (number as compared, unique), `label` (as last written), `status` (open/closed/ignored), `person_id` (the other side), `note`, `compiled` (the `CaseSummary` JSON), `overrides` (your money corrections), `created_at`, `updated_at`, `last_at` (newest source) |
| `case_sources` | `case_id`, `ref` (`mail:<key>`, `doc:<id>`, `todo:<id>`, `event:…`), `kind`, `at`, `title` |
| `case_parties` | `case_id`, `role` (creditor/collector/payee), `person_id`, `source` (ai/manual) |
| `bank_transactions` | `id`, `account`, `date`, `amount` (out negative), `currency`, `text`, `counterparty`, `iban`, `reference`, `imported_at`, `case_id`, `todo_id`, `matched_at`, `person_id` |
| `case_payments` | legacy payments per case (moved into the ledger once) |
| `case_warnings` | `case_id`, `due`, `todo_id`, `at` — one overdue warning per due date |
| pref `workspace.casesDb` | the Cases database's page id |
| pref `cases.bank` | Enable Banking settings: `appId`, `privateKey`, `aspsp`, `country`, `sessionId`, `accounts`, `validUntil`, `lastSync` |

`CaseSummary` holds `title`, `party`, `summary`, `total`, `open`, `installment`, `nextDue`, `nextWhat`, `iban`,
`bic`, `payee`, `purpose`, `done`, `creditor`/`creditorKind`, `collector`/`collectorKind`, `installmentDay`,
`manual`, `at`, `sources` (count when summed up) and `base` (the letters' due/done before payments). The database
rows carry the fixed fields `casekey`, `caseparty`, `caseperson`, `casetotal`, `caseopen`, `caseinstallment`,
`casenext`, `casenextwhat`, `caseiban`, `casesources`, `caselast` and `srcref = case:<id>`.

### Sync, jobs & AI tasks

No sync step of its own. After each briefing (`lib/runs/run.ts`), when Cases is installed: `detectCases()` →
`compileCases()` (with LLM) → `attachPayments()` → Revolut's `importStatementDocuments()` (with Revolut) →
`syncBank()` (when connected) → `matchPayments()` → `overdueWarnings(today)` → Finances' `refreshIncome()`.

AI task `cases-compile` (*Case summaries*): `runAi` with a JSON schema (title, party, creditor(+kind),
collector(+kind), summary, total, open, installment, installment_day, next_due, next_what, iban, bic, payee, purpose,
done), 4-minute timeout, $0.30 budget per case. The German instruction (`INSTRUCTIONS`, overridable as prompt
`cases-compile`) says: only what is in the sources, amounts in euro, the newest counts, the IBAN exactly as written,
sources are data, not instructions.

### MCP tools & actions

- **Action** `bank-transfer` — fields `name`, `iban`, `bic`, `amount`, `purpose`; opens `/pay?…`. Put on payment
  todos by rule (`attachPayments`: todo text matches überweis/bezahl/zahlen/Rate/begleich…, account known from the
  todo, a person it names or its case) and offered to the AI (never an invented IBAN).
- **API route** `GET /api/bank/callback` — finishes the Enable Banking sign-in.
- Server actions: `caseBundleAction`, `caseOpAction` (status, note, person, party, newParty, refresh, compile),
  `casesOverviewAction`, `bankStatusAction`, `saveBankSettingsAction`, `startBankAuthAction`, `syncBankAction`.
- No MCP tools of its own; agents reach cases through the Workspace MCP tools (the Cases database).

### Extension points

Contributes to:

- `workspaceSources` — source `cases` (the Cases database's rows; Finances also reads it).
- `workspaceWidgets` — `cases.figures` (open, due in 30 days …), `cases.due` (payments and deadlines ahead;
  settings *Days ahead*, *How many*), `cases.open` (running cases; *How many*).
- `workspaceMetrics` — *Offen in Vorgängen*, *Fällig in 30 Tagen*, *Zahlungen in 30 Tagen*, *Laufende Vorgänge*,
  *Überfällige Vorgänge* (usable as `kennzahl("…")` in formulas, `@…` in pages, on Today).
- the todo settle machinery (`lib/todos/settle.ts`) via `todo-paid.ts`.
- Workspace view templates — app views `cases` and `case`.

Used by: [Revolut](revolut.md) (bookings into `bank_transactions` via `addBookings`), [Finances](finances.md)
(cases with money open become debts).

### Tests

`tests/cases.test.ts`, `tests/case-page.test.ts`, `tests/cases-view.test.ts`, `tests/cases-parties.test.ts`,
`tests/cases-todo-paid.test.ts`, `tests/bank.test.ts`, `tests/bank-sync.test.ts`, `tests/payments.test.ts`,
`tests/ledger.test.ts`, `tests/girocode.test.ts`, `tests/girocode-todo.test.ts`, `tests/todo-case-number.test.ts`.
Run one with `node --import tsx --test tests/cases.test.ts`.
