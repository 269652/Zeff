# Evals: a prompt change must not make a run worse

Zeff's AI steps are recall-first: a missed must-do mail, a lost todo or a person never found is worse than one
proposal too many. So before a change to a step's prompt ships, it is run against **your own past decisions**:
the prompt as it is (`--base`, default `HEAD`) once, the prompt in the working tree N times, on the same frozen
cases — and anything the old prompt found that the new one misses fails the eval.

```bash
npm run eval -- list                     # the steps and their golden sets
npm run eval -- build                    # (re)build the golden sets from your data (no AI)
npm run eval -- mail --dry-run           # what a run would compare and cost (no AI)
npm run eval -- mail                     # before/after of the Mail-Durchsicht prompt (all accounts)
npm run eval -- people --account privat --runs 3 --base master~1
npm run eval -- all                      # every step
npm run eval:mail                        # = npm run eval -- mail
```

Exit code 1 when an item was **lost** (a must-have or open item the old prompt found and any new run missed) or a
run failed — so it can gate a deploy or a commit hook.

## Before shipping a prompt change

1. Edit the step's `INSTRUCTIONS` (the files are listed below). Don't commit yet — "after" is the working tree.
2. `npm run eval -- build` if the golden sets are old or missing (`list` shows their dates). Building costs nothing.
3. `npm run eval -- <step> --dry-run` — how many cases, how many AI calls, what they will cost.
4. `npm run eval -- <step>` — read the report:
   - `VERLOREN` — lost items, each named (sender and subject, note title, person and message, todo). Any one fails.
     AI answers vary; one miss in one run is enough (recall first). Re-run before you conclude it's noise — and if
     the prompt is unchanged against the base, the report says so: then the losses *are* the noise.
   - `GEWONNEN` — what only the new prompt found. Good, no gate.
   - `Neu gefunden, aber von dir verworfen` — something you dropped before is found again: worse precision,
     reported, never a failure.
   - `behalten / offen / verworfen` per run — found of the must-haves / open / negatives; `ungewertet` counts what
     was found that you never judged.
5. Fix the prompt until nothing is lost, then commit. Never add "im Zweifel weglassen" to win precision back.

Edits made in **System → Prompts** (a prompt's page) are not what is compared: the eval compares the code's
built-in instructions at the base ref and in the working tree.

## Steps

| Step | What | Instructions | Item | must | negative | open |
|---|---|---|---|---|---|---|
| `mail` | Mail-Durchsicht | `src/lib/todos/mail-todos.ts` | a mail | a todo of it you did; every must-do mail (training, signature) | a todo of it you dropped | its todo still open |
| `notes` | Notiz-Durchsicht | `src/plugins/keep/note-review.ts` | a note | its todo you did | its todo you dropped | its todo open |
| `people` | Personen-Extraktion | `src/plugins/people/extract.ts` | person + message (`<personId>@<ref>`) | a claim/link you confirmed | rejected | still proposed |
| `auto-actions` | Auto-Aktionen | `src/plugins/auto-actions/review.ts` | `todo:<id>` (gets ≥ 1 valid action), `todo:<id>:<type>` | a todo with proposed actions you did; an action you ran (ledger) | an action you took off; all of them: the todo too (ledger) | open todo; each kind of action it has |

Each case is frozen as the step would see it, through the step's own prompt builder (`mailReviewPrompt`,
`noteReviewPrompt`, `extractPrompt`, `autoActionsPrompt`) and its own checks of the answer (the must-do safety net,
`noteRefsOf`, `acceptFindings`, `cleanOps`). What would give the answer away is left out: the review's own todos
(mail, notes), the claims the case is about as "known" or "rejected" (people). The people step is run with one AI
call (no retrieval rounds).

## Golden sets

`npm run eval -- build [--account …]` snapshots each account's database (a copy, deleted afterwards), derives the
labels and writes `data/evals/<account>/<step>.json`. **They hold your mail, notes and people: `data/` is
git-ignored, never commit or share them.** A step with nothing judged yet writes no file (an older one stays).
Without a golden set, a step's cases come straight from the current data (as `--live` forces) — they move as your
data moves, so build the set before you start changing a prompt.

Other records of your decisions plug into the builder as a `VerdictSource` (`src/lib/evals/golden.ts`): its verdicts
(`{ step, item, label }`, items named as above) override the derived labels of the items a case has. `build` lays the
`ai_feedback` ledger over them that way (`src/lib/evals/ledger.ts`, accepted → must, rejected → negative): the
auto-actions you ran are musts, those you took off negatives — one action (`todo:<id>:<type>`), or all of them (the
todo too; such a todo keeps no proposal, so the adapter freezes it from the ledger's). The other steps' ledger rows
are what their adapters already read from the same tables, so they don't come in (they would override the adapters'
merges: a mail with one todo done and one dropped stays a must).

## Costs

Per step: cases × (1 + runs) AI calls on the account's own backend and model for the step (Settings → LLM). The
dry run prints the count, an estimate from your usage log (the step's average cost per call so far) and the cap
(each call's budget). With the default `--runs 2`, on the data of 2026-10-22:

| Step | Calls (default · privat) | About | Cap per call |
|---|---|---|---|
| mail | 3 · 3 | $0.15 · $0.50 | $1 |
| notes | cases × 3 | like mail (~$0.05–0.17 a call) | $1 |
| people | 30 · 6 | $0.95 · $0.20 | $0.50 |
| auto-actions | 27 · 36 | $2.50 · $4.30 | $1 |

`--runs 1` cuts it by a third; checking only the step you changed is the cheap default.

## A new step

An adapter in `src/lib/evals/adapters/` (`EvalAdapter`, `src/lib/evals/harness.ts`): `build()` freezes the cases and
labels from the open database, `run(case, instructions, ask)` builds the step's prompt with the given instructions,
asks, applies the step's own checks and returns the items covered. Register it in `src/lib/evals/index.ts` and add a
row above. Test it with a fake `ask` (see `tests/eval-adapters.test.ts`) — tests never call a real AI; the CLI takes
`--fake <module>` (default export: the AI) for that.
