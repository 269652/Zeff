"use server";

import { revalidatePath } from "next/cache";
import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { revalidateAll, str, type ActionState } from "@/app/action-helpers";

/** Boards (your tickets gone through the Claude CLI: what happened, what's to do) — its server actions (each answers an ActionState unless it says otherwise). */

/** "Run now": the run starts in the background — the Todos page follows it. */
export async function runBoardAction(): Promise<ActionState> {
  const { startBoardRun } = await import("@/lib/boards/run");
  // By hand: Jira synced first, then the analysis.
  const r = startBoardRun({ syncJira: true });
  revalidatePath("/todos");
  return r.ok ? { ok: true, message: r.message } : { ok: false, error: r.message };
}

/** Which tickets on the chosen boards (a JQL filter) — how often a run goes by itself: the Sync settings page. */
export async function saveBoardSettingsAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const jql = (str(fd, "jql") ?? "").trim();
  if (jql.length < 5) return { ok: false, error: t("A JQL filter, e.g.: {example}", { example: "assignee = currentUser() AND resolution = Unresolved" }) };
  const { updateBoardSettings } = await import("@/lib/boards/store");
  updateBoardSettings({ jql: jql.slice(0, 1000) });
  revalidatePath("/todos");
  return { ok: true, message: t("Saved.") };
}

/** Stop the Ticket-Lage's run ("Analyse now"). */
export async function stopBoardRunAction(): Promise<ActionState> {
  const { stopBoardRun } = await import("@/lib/boards/run");
  revalidatePath("/todos");
  return stopBoardRun() ? { ok: true, message: t("The analysis is being stopped.") } : { ok: false, error: t("No analysis is running.") };
}

/** A todo done, dismissed, or open again. */
/** A todo you add to a ticket yourself — a Kanban card's checklist. */
export async function addCardTodoAction(ticket: string, text: string): Promise<ActionState> {
  try {
    const body = String(text ?? "").trim();
    const k = String(ticket ?? "").trim();
    if (!body) return { ok: false, error: t("What's to be done?") };
    if (!k) return { ok: false, error: t("No card.") };
    const { addManualTodo } = await import("@/lib/boards/store");
    const todo = addManualTodo({ ticket: k, text: body });
    revalidateAll();
    return { ok: true, message: todo.outcome === "merged" ? t("{ref} says the same already - merged into it.", { ref: todo.ref }) : t("{ref} created.", { ref: todo.ref }) };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function setTodoStatusAction(id: number, status: "open" | "done" | "dismissed"): Promise<ActionState> {
  try {
    if (!Number.isInteger(id) || !["open", "done", "dismissed"].includes(status)) return { ok: false, error: t("Unknown todo.") };
    const { setTodoStatus } = await import("@/lib/boards/store");
    const { attributed } = await import("@/lib/boards/activity");
    attributed("you", () => setTodoStatus(id, status, status === "open" ? null : undefined));
    // A step ticked off brings the next one (a delivery): its actions from git, at once — no AI.
    if (status === "done") void import("@/lib/boards/delivery-ops").then((m) => m.attachOpenMrOps()).then(() => revalidateAll()).catch(() => {});
    revalidateAll();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** The context search's todos: done ones first (work that backs an entry), then open ones. */
export async function searchTodosAction(q: string): Promise<import("@/lib/boards/shared").TodoView[]> {
  const { searchTodos } = await import("@/lib/boards/store");
  return searchTodos(String(q ?? "").slice(0, 200));
}

/** A todo's operations, run now by Zeff itself (a WhatsApp message, a note, a comment) — not through Work. */
export async function runTodoOpsAction(todoId: number, only?: number[]): Promise<ActionState> {
  try {
    const { runTodoOpsNow } = await import("@/lib/ops");
    const r = await runTodoOpsNow(Number(todoId), { only: Array.isArray(only) ? only.map(Number).filter(Number.isInteger) : undefined });
    revalidateAll();
    return { ok: true, message: `${r.done.join(" · ")}${r.settled ? ` — ${t("done.")}` : ""}` };
  } catch (err) {
    revalidateAll();
    return { ok: false, error: errorMessage(err) };
  }
}

/** Your instruction on a todo, done by the Copilot CLI — a run on the Work tab. */
export async function instructTodoAction(todoId: number, instruction: string): Promise<ActionState> {
  try {
    const text = String(instruction ?? "").trim();
    if (!text) return { ok: false, error: t("What should Copilot do?") };
    const { dispatchTodo } = await import("@/lib/work/runner");
    const run = dispatchTodo(Number(todoId), { provider: "copilot", instruction: text.slice(0, 8000) });
    revalidateAll();
    return { ok: true, message: run.status === "running" ? t("{run} (Copilot) is running.", { run: run.ref }) : t("{run} (Copilot) is waiting for a free worker.", { run: run.ref }) };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** A todo flagged important (to the top of its list, urgent for the Ticket-Lage) — or the flag taken off. */
export async function flagTodoAction(todoId: number, flagged: boolean): Promise<ActionState> {
  try {
    const { setTodoFlagged } = await import("@/lib/boards/store");
    setTodoFlagged(Number(todoId), !!flagged);
    revalidateAll();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** A reply to the message a todo is about, drafted by the AI from the conversation — never sent. */
export async function draftReplyAction(todoId: number): Promise<import("@/lib/boards/reply-draft").ReplyDraft> {
  try {
    return await (await import("@/lib/boards/reply-draft")).draftReply(Number(todoId));
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** A reply's "Öffnen": WhatsApp Web, Gmail, Outlook or Teams at the front of the automation Chrome (signed in there). */
export async function openReplyTargetAction(url: string): Promise<ActionState> {
  try {
    const { REPLY_HOSTS } = await import("@/lib/boards/reply-draft");
    if (!REPLY_HOSTS.test(String(url))) return { ok: false, error: t("Zeff doesn't open this address.") };
    const { openInAutomationChrome } = await import("@/lib/attention");
    const r = await openInAutomationChrome(String(url), new URL(String(url)).host);
    return r.ok ? { ok: true, message: t("In front in the automation Chrome — paste the draft and send it.") } : { ok: false, error: r.message };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** The Auswerten page: one step's context settings (sources, numbers, its own instructions). */
export async function saveContextPrefsAction(step: string, patch: { sources?: Record<string, boolean>; numbers?: Record<string, number>; extra?: string }): Promise<ActionState> {
  try {
    const { CONTEXT_STEP_IDS } = await import("@/lib/boards/context-prefs-shared");
    if (!(CONTEXT_STEP_IDS as readonly string[]).includes(step)) return { ok: false, error: t("Unknown step.") };
    const { setStepPrefs } = await import("@/lib/boards/context-prefs");
    setStepPrefs(step as (typeof CONTEXT_STEP_IDS)[number], patch ?? {});
    revalidatePath("/auswerten");
    return { ok: true, message: t("Saved — applies from the next run on.") };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** A todo's deadline (YYYY-MM-DD) — or none. */
export async function setTodoDueAction(todoId: number, due: string | null): Promise<ActionState> {
  try {
    const { setTodoDue } = await import("@/lib/boards/store");
    setTodoDue(Number(todoId), due ? String(due) : null);
    revalidateAll();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** A todo put to the bottom for now — it comes back up when something new happens on it — or taken back up. */
export async function deferTodoAction(todoId: number, deferred: boolean): Promise<ActionState> {
  try {
    const { setTodoDeferred } = await import("@/lib/boards/store");
    setTodoDeferred(Number(todoId), !!deferred);
    revalidateAll();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Your note on a todo (context for whoever works on it) — added, or taken away by its time. */
export async function addTodoNoteAction(todoId: number, text: string): Promise<ActionState> {
  try {
    if (!String(text ?? "").trim()) return { ok: false, error: t("The note is empty.") };
    const { addTodoUserNote } = await import("@/lib/boards/store");
    const todo = addTodoUserNote(Number(todoId), String(text));
    revalidateAll();
    // The todo brought up to date with the note at once (its text, kind, done …, then its actions) —
    // in the background, just this todo: no whole run needed. While a run is under way, it reads the note itself.
    const { canRefreshTodo, refreshTodoSoon } = await import("@/lib/boards/todo-refresh");
    if (todo && canRefreshTodo(todo)) {
      refreshTodoSoon(todo.id);
      return { ok: true, message: t("Note saved — the todo is being updated with it.") };
    }
    // (Can't now — a run under way: its actions proposed by the auto-actions, proposed again with the note.)
    if (todo?.autoOpsWhy && todo.ops.length && (await import("@/plugins/state")).isInstalled("auto-actions")) {
      const { reviewTodosForActions } = await import("@/plugins/auto-actions/review");
      void reviewTodosForActions({ ids: [todo.id] }).catch(() => {});
      return { ok: true, message: t("Note saved — the actions are proposed again with it.") };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Time you spent on a todo, by hand: minutes and one line (a record like the agents'). */
export async function addTodoTimeAction(todoId: number, minutes: number, note: string): Promise<ActionState> {
  try {
    const { addTodoTime } = await import("@/lib/work/todo-time");
    addTodoTime({ todoId: Number(todoId), minutes: Number(minutes), note: String(note ?? ""), by: "Du", source: "hand" });
    revalidateAll();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** "Worked on it": a booking suggestion for the todo (its ticket, its recorded time) — the todo stays open. */
export async function workedOnTodoAction(todoId: number): Promise<ActionState> {
  try {
    const { suggestWorkedOn, suggestionRef } = await import("@/lib/work/suggestions");
    const made = suggestWorkedOn([Number(todoId)], { reportedBy: "Du" });
    revalidateAll();
    if (!made.length) return { ok: true, message: t("There is a booking suggestion for it today already — or it has no ticket.") };
    return { ok: true, message: t("{ref} suggested — in the Weekly report you can take it over.", { ref: suggestionRef(made[0].id) }) };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Your note on a todo changed. */
export async function updateTodoNoteAction(todoId: number, at: string, text: string): Promise<ActionState> {
  try {
    const { updateTodoUserNote } = await import("@/lib/boards/store");
    updateTodoUserNote(Number(todoId), String(at), String(text ?? ""));
    revalidateAll();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Your note put on the todo's Jira ticket as a comment (edited there when the note changed since); tagged people become Jira mentions. */
export async function syncNoteToJiraAction(todoId: number, at: string): Promise<ActionState> {
  try {
    const { syncNoteToJira } = await import("@/lib/jira/note-sync");
    const r = await syncNoteToJira(Number(todoId), String(at));
    revalidateAll();
    const hint = r.noAccount.length ? ` ${t("No Jira account linked for {names} — written out, not mentioned.", { names: r.noAccount.join(", ") })}` : "";
    const what =
      r.state === "posted"
        ? t("Note put on Jira as a comment.")
        : r.state === "updated"
          ? t("The comment on Jira is updated.")
          : r.state === "reposted"
            ? t("The comment was gone from Jira — the note is posted again.")
            : t("The comment on Jira is as the note is.");
    return { ok: true, message: `${what}${hint}` };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** People for @-tagging (the People plugin): by name, alias or Jira username — with their Jira account, if linked. */
export async function searchPeopleAction(q: string): Promise<{ id: number; name: string; jira: string | null }[]> {
  try {
    if (!(await import("@/plugins/state")).isInstalled("people")) return [];
    const { listPeople } = await import("@/plugins/people/store");
    // Jira users Zeff knows by name are tied to the profiles first (so "no Jira account" is true).
    (await import("@/plugins/people/accounts")).linkJiraAccounts();
    const w = String(q ?? "").trim().toLowerCase();
    return listPeople()
      .map((p) => ({ p, forms: [p.name, ...p.aliases, ...p.accounts.map((a) => a.value)].map((f) => f.toLowerCase()) }))
      .filter(({ forms }) => !w || forms.some((f) => f.startsWith(w) || f.split(/\s+/).some((x) => x.startsWith(w))))
      .sort((a, b) => Number(b.forms.some((f) => f.startsWith(w))) - Number(a.forms.some((f) => f.startsWith(w))) || Number(b.p.starred) - Number(a.p.starred))
      .slice(0, 8)
      .map(({ p }) => ({ id: p.id, name: p.name, jira: p.accounts.find((a) => a.kind === "jira")?.value ?? null }));
  } catch {
    return [];
  }
}

/** A context item taken out of a todo by hand — it stays out. */
export async function dismissTodoContextAction(todoId: number, ref: string): Promise<ActionState> {
  try {
    const { dismissTodoContext } = await import("@/lib/boards/store");
    dismissTodoContext(Number(todoId), String(ref ?? ""));
    revalidateAll();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** A question to a ticket: answered from what Zeff has on it, kept as the ticket's context (until dismissed). */
export async function askTicketAction(ticket: string, question: string): Promise<{ ok: boolean; item?: import("@/lib/boards/ticket-chat").ChatItem; error?: string }> {
  try {
    const { askTicket } = await import("@/lib/boards/ticket-chat");
    const item = await askTicket(String(ticket ?? ""), String(question ?? ""));
    revalidateAll();
    return { ok: true, item };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** An answer of a ticket's chat taken out of its context. */
export async function dismissChatItemAction(id: number): Promise<ActionState> {
  try {
    const { dismissChatItem } = await import("@/lib/boards/ticket-chat");
    dismissChatItem(Number(id));
    revalidateAll();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** A time record taken away — while no booking or suggestion covers it. */
export async function deleteTodoTimeAction(id: number): Promise<ActionState> {
  try {
    const { deleteTodoTime } = await import("@/lib/work/todo-time");
    deleteTodoTime(Number(id));
    revalidateAll();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function removeTodoNoteAction(todoId: number, at: string): Promise<ActionState> {
  try {
    const { removeTodoUserNote } = await import("@/lib/boards/store");
    removeTodoUserNote(Number(todoId), String(at));
    revalidateAll();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** One of a Boards run's suggested ticket changes (transition, assignee, comment), done in Jira — on your click. */
export async function runTicketActionAction(runId: number, ticket: string, idx: number): Promise<ActionState> {
  try {
    const { runTicketAction } = await import("@/lib/boards/actions");
    const r = await runTicketAction(Number(runId), String(ticket), Number(idx));
    revalidateAll();
    return { ok: true, message: `${ticket}: ${r.detail}.` };
  } catch (err) {
    revalidateAll();
    return { ok: false, error: errorMessage(err) };
  }
}

/** A todo done another way (one of its alternatives — "Rico zuweisen", "Merge into main"): its operations replaced, then run. */
export async function runTodoAlternativeAction(todoId: number, label: string): Promise<ActionState> {
  try {
    const { getTodo, setTodoOps } = await import("@/lib/boards/store");
    const { todoAlternatives } = await import("@/lib/boards/alternatives");
    const todo = getTodo(Number(todoId));
    if (!todo || todo.status !== "open") return { ok: false, error: t("That todo isn't open.") };
    const alt = (todoAlternatives([todo])[todo.id] ?? []).find((a) => a.label === String(label));
    if (!alt) return { ok: false, error: t("That option isn't there any more.") };
    const { dispatchTodo } = await import("@/lib/work/runner");
    if (alt.also) {
      // On its own: a todo of its own (traceable, under this one), run at once — this one stays as it is.
      const { addFollowUp } = await import("@/lib/boards/store");
      const { attributed } = await import("@/lib/boards/activity");
      const child = attributed("you", () => addFollowUp({ ticket: todo.ticket, text: alt.title, kind: "update", parentId: todo.id, workRunId: null, source: `Option for ${todo.ref}`, ops: alt.ops }));
      const run = dispatchTodo(child.id);
      revalidateAll();
      return { ok: true, message: `${run.ref}: ${alt.title}.` };
    }
    setTodoOps(todo.id, alt.ops, alt.text);
    const run = dispatchTodo(todo.id);
    revalidateAll();
    return { ok: true, message: `${run.ref}: ${alt.label}.` };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** The Recap: a day's recap made (in the background) — the page follows it. */
export async function startRecapAction(day: string): Promise<ActionState> {
  try {
    const { startRecap } = await import("@/lib/boards/recap");
    const r = startRecap(String(day));
    revalidateAll();
    return r.ok ? { ok: true, message: r.message } : { ok: false, error: r.message };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** An operation's text (a comment, a reply, a Teams message) changed before it's sent. */
export async function saveTodoOpTextAction(todoId: number, index: number, text: string): Promise<ActionState> {
  try {
    const { getTodo, setTodoOps } = await import("@/lib/boards/store");
    const todo = getTodo(Number(todoId));
    if (!todo || todo.status !== "open") return { ok: false, error: t("That todo isn't open.") };
    const op = todo.ops[Number(index)];
    const body = String(text ?? "").trim();
    if (!op || !("body" in op)) return { ok: false, error: t("That operation has no text.") };
    if (!body) return { ok: false, error: t("Empty text.") };
    setTodoOps(todo.id, todo.ops.map((o, i) => (i === Number(index) ? { ...o, body: body.slice(0, 8000) } : o)) as typeof todo.ops);
    revalidateAll();
    return { ok: true, message: t("Saved.") };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** A ticket followed in the Ticket-Lage besides the boards' filter (1), not any more (-1), or as it comes (0). */
export async function setTicketFollowAction(key: string, value: 1 | -1 | 0): Promise<ActionState> {
  try {
    const { setFollowed } = await import("@/lib/boards/followed");
    setFollowed(String(key), value === 1 || value === -1 ? value : 0);
    revalidateAll();
    return {
      ok: true,
      message: value === 1 ? t("{key}: followed from now on (from the next run).", { key }) : value === -1 ? t("{key}: no longer followed.", { key }) : t("{key}: as it comes.", { key }),
    };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/**
 * An action you did in your browser (the appointment saved in Outlook, the mail draft sent):
 * taken off the todo and noted on it — so the Lage and everyone know. A mail that is the todo
 * (a reply, a question) ticks it off.
 */
export async function doneBrowserOpAction(todoId: number, index: number): Promise<ActionState> {
  try {
    const { getTodo, addTodoUserNote, setTodoStatus } = await import("@/lib/boards/store");
    const { actionHref } = await import("@/plugins/actions/catalog");
    const { getDb, schema } = await import("@/db");
    const { eq } = await import("drizzle-orm");
    const todo = getTodo(Number(todoId));
    const op = todo?.ops[Number(index)];
    if (!todo || !op || !actionHref(op)) return { ok: false, error: t("That action isn't on the todo (any more).") };
    const left = todo.ops.filter((_, i) => i !== Number(index));
    getDb().update(schema.todos).set({ ops: JSON.stringify(left) }).where(eq(schema.todos.id, todo.id)).run();
    const { formatDayTime: when } = await import("@/lib/format");
    const what =
      op.type === "calendar-event"
        ? op.attendees
          ? t("Meeting “{subject}” created in Outlook ({when}, {minutes} min, with {attendees}).", { subject: op.subject, when: when(op.start), minutes: op.minutes, attendees: op.attendees.replace(/;/g, ", ") })
          : t("Meeting “{subject}” created in Outlook ({when}, {minutes} min).", { subject: op.subject, when: when(op.start), minutes: op.minutes })
        : op.type === "gcal-event"
          ? t("Meeting “{subject}” created in Google Calendar ({when}, {minutes} min).", { subject: op.title, when: when(op.start), minutes: op.minutes })
          : op.type === "mail-compose"
            ? op.to
              ? t("Mail “{subject}” to {to} sent.", { subject: op.subject, to: op.to.replace(/;/g, ", ") })
              : t("Mail “{subject}” sent.", { subject: op.subject })
            : t("Done in the browser.");
    addTodoUserNote(todo.id, `✓ ${what}`);
    // A mail that answers or asks — the todo itself, done with it.
    const settles = op.type === "mail-compose" && !left.length && todo.owner === "me" && ["reply", "comment", "clarify", "update"].includes(todo.kind);
    if (settles) {
      const { attributed } = await import("@/lib/boards/activity");
      attributed("you", () => setTodoStatus(todo.id, "done", `Done: ${what}`));
    }
    revalidateAll();
    return { ok: true, message: settles ? t("{ref} done — {what}", { ref: todo.ref, what }) : t("Noted on {ref}: {what}", { ref: todo.ref, what }) };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Ready actions for one todo, now (the auto-actions review, asked for on it). */
export async function suggestTodoActionsAction(todoId: number): Promise<ActionState> {
  try {
    const { isInstalled } = await import("@/plugins/state");
    if (!isInstalled("auto-actions")) return { ok: false, error: t("Auto actions are not installed (Menu → Plugins).") };
    const { reviewTodosForActions } = await import("@/plugins/auto-actions/review");
    const r = await reviewTodosForActions({ ids: [Number(todoId)] });
    revalidateAll();
    if (!r.ok) return { ok: false, error: r.error ?? t("The AI didn't answer.") };
    if (!r.reviewed) return { ok: false, error: t("The todo already has actions (from the briefing) — they stay.") };
    return { ok: true, message: r.withActions ? t("Actions suggested — on the todo.") : t("No fitting action found.") };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** An action taken off a todo, without a trace (not wanted) — the auto-actions don't propose it again till the todo changes. */
export async function removeTodoOpAction(todoId: number, index: number): Promise<ActionState> {
  try {
    const { getTodo } = await import("@/lib/boards/store");
    const { getDb, schema } = await import("@/db");
    const { eq } = await import("drizzle-orm");
    const todo = getTodo(Number(todoId));
    const op = todo?.ops[Number(index)];
    if (!todo || !op) return { ok: false, error: t("That action isn't on the todo (any more).") };
    const left = todo.ops.filter((_, i) => i !== Number(index));
    getDb()
      .update(schema.todos)
      .set({ ops: JSON.stringify(left), actionsReviewedAt: new Date().toISOString(), ...(left.length ? {} : { autoOpsWhy: null }) })
      .where(eq(schema.todos.id, todo.id))
      .run();
    revalidateAll();
    return { ok: true, message: t("Action removed.") };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Settings → Todos: which toggles a todo shows and which kinds of knowledge go into it (what's unticked is off). */
export async function saveTodoDisplayFormAction(fd: FormData): Promise<void> {
  const { AREAS, KNOWLEDGE_KINDS } = await import("@/lib/todo-display");
  const { setTodoDisplayOff } = await import("@/lib/todo-display-store");
  const ids = [...AREAS.map((a) => `area:${a}`), ...KNOWLEDGE_KINDS.map((k) => `kind:${k}`), "entities", "links"];
  setTodoDisplayOff(ids.filter((id) => fd.get(id) !== "on"));
  revalidateAll();
}
