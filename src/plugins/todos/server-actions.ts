"use server";

import { revalidatePath } from "next/cache";
import { errorMessage } from "@/lib/errors";
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
  if (jql.length < 5) return { ok: false, error: "Ein JQL-Filter, z. B.: assignee = currentUser() AND resolution = Unresolved" };
  const { updateBoardSettings } = await import("@/lib/boards/store");
  updateBoardSettings({ jql: jql.slice(0, 1000) });
  revalidatePath("/todos");
  return { ok: true, message: "Gespeichert." };
}

/** Stop the Ticket-Lage's run ("Jetzt auswerten"). */
export async function stopBoardRunAction(): Promise<ActionState> {
  const { stopBoardRun } = await import("@/lib/boards/run");
  revalidatePath("/todos");
  return stopBoardRun() ? { ok: true, message: "Die Auswertung wird abgebrochen." } : { ok: false, error: "Es läuft keine Auswertung." };
}

/** A todo done, dismissed, or open again. */
/** A todo you add to a ticket yourself — a Kanban card's checklist. */
export async function addCardTodoAction(ticket: string, text: string): Promise<ActionState> {
  try {
    const t = String(text ?? "").trim();
    const k = String(ticket ?? "").trim();
    if (!t) return { ok: false, error: "Was ist zu tun?" };
    if (!k) return { ok: false, error: "Keine Karte." };
    const { addManualTodo } = await import("@/lib/boards/store");
    const todo = addManualTodo({ ticket: k, text: t });
    revalidateAll();
    return { ok: true, message: `${todo.ref} angelegt.` };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function setTodoStatusAction(id: number, status: "open" | "done" | "dismissed"): Promise<ActionState> {
  try {
    if (!Number.isInteger(id) || !["open", "done", "dismissed"].includes(status)) return { ok: false, error: "Unbekanntes Todo." };
    const { setTodoStatus } = await import("@/lib/boards/store");
    const { attributed } = await import("@/lib/boards/activity");
    attributed("you", () => setTodoStatus(id, status, status === "open" ? null : undefined));
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
export async function runTodoOpsAction(todoId: number): Promise<ActionState> {
  try {
    const { runTodoOpsNow } = await import("@/lib/ops");
    const r = await runTodoOpsNow(Number(todoId));
    revalidateAll();
    return { ok: true, message: `${r.done.join(" · ")}${r.settled ? " — erledigt." : ""}` };
  } catch (err) {
    revalidateAll();
    return { ok: false, error: errorMessage(err) };
  }
}

/** Your instruction on a todo, done by the Copilot CLI — a run on the Work tab. */
export async function instructTodoAction(todoId: number, instruction: string): Promise<ActionState> {
  try {
    const text = String(instruction ?? "").trim();
    if (!text) return { ok: false, error: "Was soll Copilot tun?" };
    const { dispatchTodo } = await import("@/lib/work/runner");
    const run = dispatchTodo(Number(todoId), { provider: "copilot", instruction: text.slice(0, 8000) });
    revalidateAll();
    return { ok: true, message: `${run.ref} (Copilot) ${run.status === "running" ? "läuft" : "wartet auf einen freien Worker"}.` };
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
    if (!REPLY_HOSTS.test(String(url))) return { ok: false, error: "Diese Adresse öffnet Zeff nicht." };
    const { openInAutomationChrome } = await import("@/lib/attention");
    const r = await openInAutomationChrome(String(url), new URL(String(url)).host);
    return r.ok ? { ok: true, message: "Im Automations-Chrome vorne — Entwurf einfügen und abschicken." } : { ok: false, error: r.message };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** The Auswerten page: one step's context settings (sources, numbers, its own instructions). */
export async function saveContextPrefsAction(step: string, patch: { sources?: Record<string, boolean>; numbers?: Record<string, number>; extra?: string }): Promise<ActionState> {
  try {
    const { CONTEXT_STEP_IDS } = await import("@/lib/boards/context-prefs-shared");
    if (!(CONTEXT_STEP_IDS as readonly string[]).includes(step)) return { ok: false, error: "Unbekannter Schritt." };
    const { setStepPrefs } = await import("@/lib/boards/context-prefs");
    setStepPrefs(step as (typeof CONTEXT_STEP_IDS)[number], patch ?? {});
    revalidatePath("/auswerten");
    return { ok: true, message: "Gespeichert — gilt ab dem nächsten Lauf." };
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
    if (!String(text ?? "").trim()) return { ok: false, error: "Die Notiz ist leer." };
    const { addTodoUserNote } = await import("@/lib/boards/store");
    const t = addTodoUserNote(Number(todoId), String(text));
    revalidateAll();
    // Its actions proposed by the auto-actions (not run, not edited): proposed again with the note — in the background.
    if (t?.autoOpsWhy && t.ops.length && (await import("@/plugins/state")).isInstalled("auto-actions")) {
      const { reviewTodosForActions } = await import("@/plugins/auto-actions/review");
      void reviewTodosForActions({ ids: [t.id] }).catch(() => {});
      return { ok: true, message: "Notiz gespeichert — die Aktionen werden damit neu vorgeschlagen." };
    }
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

/** A todo's drafted message, as you changed it (empty: none — a worker writes one again). */
export async function saveTodoDraftAction(todoId: number, draft: string): Promise<ActionState> {
  try {
    const { setTodoDraft } = await import("@/lib/boards/store");
    setTodoDraft(Number(todoId), { draft: String(draft ?? "") });
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
    const t = getTodo(Number(todoId));
    if (!t || t.status !== "open") return { ok: false, error: "That todo isn't open." };
    const alt = (todoAlternatives([t])[t.id] ?? []).find((a) => a.label === String(label));
    if (!alt) return { ok: false, error: "That option isn't there any more." };
    const { dispatchTodo } = await import("@/lib/work/runner");
    if (alt.also) {
      // On its own: a todo of its own (traceable, under this one), run at once — this one stays as it is.
      const { addFollowUp } = await import("@/lib/boards/store");
      const { attributed } = await import("@/lib/boards/activity");
      const child = attributed("you", () => addFollowUp({ ticket: t.ticket, text: alt.title, kind: "update", parentId: t.id, workRunId: null, source: `Option zu ${t.ref}`, ops: alt.ops }));
      const run = dispatchTodo(child.id);
      revalidateAll();
      return { ok: true, message: `${run.ref}: ${alt.title}.` };
    }
    setTodoOps(t.id, alt.ops, alt.text);
    const run = dispatchTodo(t.id);
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
    const t = getTodo(Number(todoId));
    if (!t || t.status !== "open") return { ok: false, error: "That todo isn't open." };
    const op = t.ops[Number(index)];
    const body = String(text ?? "").trim();
    if (!op || !("body" in op)) return { ok: false, error: "That operation has no text." };
    if (!body) return { ok: false, error: "Empty text." };
    setTodoOps(t.id, t.ops.map((o, i) => (i === Number(index) ? { ...o, body: body.slice(0, 8000) } : o)) as typeof t.ops);
    revalidateAll();
    return { ok: true, message: "Saved." };
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
    return { ok: true, message: value === 1 ? `${key}: wird weiter verfolgt (ab dem nächsten Lauf).` : value === -1 ? `${key}: nicht mehr verfolgt.` : `${key}: wie es kommt.` };
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
    const t = getTodo(Number(todoId));
    const op = t?.ops[Number(index)];
    if (!t || !op || !actionHref(op)) return { ok: false, error: "Diese Aktion gibt es am Todo nicht (mehr)." };
    const left = t.ops.filter((_, i) => i !== Number(index));
    getDb().update(schema.todos).set({ ops: JSON.stringify(left) }).where(eq(schema.todos.id, t.id)).run();
    const when = (iso: string) => new Date(iso).toLocaleString("de-DE", { weekday: "short", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
    const what =
      op.type === "calendar-event"
        ? `Termin „${op.subject}“ in Outlook angelegt (${when(op.start)}, ${op.minutes} min${op.attendees ? `, mit ${op.attendees.replace(/;/g, ", ")}` : ""}).`
        : op.type === "gcal-event"
          ? `Termin „${op.title}“ in Google Calendar angelegt (${when(op.start)}, ${op.minutes} min).`
          : op.type === "mail-compose"
            ? `Mail „${op.subject}“${op.to ? ` an ${op.to.replace(/;/g, ", ")}` : ""} gesendet.`
            : "Im Browser erledigt.";
    addTodoUserNote(t.id, `✓ ${what}`);
    // A mail that answers or asks — the todo itself, done with it.
    const settles = op.type === "mail-compose" && !left.length && t.owner === "me" && ["reply", "comment", "clarify", "update"].includes(t.kind);
    if (settles) {
      const { attributed } = await import("@/lib/boards/activity");
      attributed("you", () => setTodoStatus(t.id, "done", `Erledigt: ${what}`));
    }
    revalidateAll();
    return { ok: true, message: settles ? `${t.ref} erledigt — ${what}` : `Vermerkt an ${t.ref}: ${what}` };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Ready actions for one todo, now (the auto-actions review, asked for on it). */
export async function suggestTodoActionsAction(todoId: number): Promise<ActionState> {
  try {
    const { isInstalled } = await import("@/plugins/state");
    if (!isInstalled("auto-actions")) return { ok: false, error: "Auto-Aktionen sind nicht installiert (Menü → Plugins)." };
    const { reviewTodosForActions } = await import("@/plugins/auto-actions/review");
    const r = await reviewTodosForActions({ ids: [Number(todoId)] });
    revalidateAll();
    if (!r.ok) return { ok: false, error: r.error ?? "Die KI hat nicht geantwortet." };
    if (!r.reviewed) return { ok: false, error: "Das Todo hat schon Aktionen (aus der Ticket-Lage) — die bleiben." };
    return { ok: true, message: r.withActions ? "Aktionen vorgeschlagen — am Todo." : "Keine passende Aktion gefunden." };
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
    const t = getTodo(Number(todoId));
    const op = t?.ops[Number(index)];
    if (!t || !op) return { ok: false, error: "Diese Aktion gibt es am Todo nicht (mehr)." };
    const left = t.ops.filter((_, i) => i !== Number(index));
    getDb()
      .update(schema.todos)
      .set({ ops: JSON.stringify(left), actionsReviewedAt: new Date().toISOString(), ...(left.length ? {} : { autoOpsWhy: null }) })
      .where(eq(schema.todos.id, t.id))
      .run();
    revalidateAll();
    return { ok: true, message: "Aktion entfernt." };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
