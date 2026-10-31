import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { ROOT, setupTempData } from "./helpers";

// "✨ Think along" (Mitdenken) on a page: the AI understands a block, asks what is missing (chips in a card), proposes what to set up
// (a plan calendar, todos, widgets, text) — and only "Apply" sets it up. Never a real AI here: the fake CLI answers.
const dir = setupTempData();
process.env.CLAUDE_CLI = path.join(ROOT, "tests", "fake-claude-json.mjs");
const promptFile = path.join(dir, "prompt.txt");
process.env.FAKE_CLAUDE_PROMPT_FILE = promptFile;

const setup = async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["llm", "claude-cli", "workspace", "calendar", "todos", "people"]) setInstalled(id, true);
  const { updateAppSettings } = await import("@/lib/ai");
  updateAppSettings({ aiProvider: "claude" });
  const people = await import("@/plugins/people/store");
  return { nadine: people.createPerson({ name: "Nadine", note: "Wohnt in Hamburg." }), karla: people.createPerson({ name: "Karla" }) };
};

const check = (over: Partial<import("@/plugins/workspace/assist").AssistCheck> = {}): import("@/plugins/workspace/assist").AssistCheck => ({
  person: (id) => (id === 12 ? "Nadine" : null),
  widgets: new Map([["people.coming", { label: "Coming up with a person", settings: ["person", "limit"] }]]),
  busy: [],
  can: { calendar: true, todos: true },
  ...over,
});

test("the page-assist task is one of the LLM's tasks (its own backend and model)", async () => {
  const { LLM_TASKS, isLlmTask } = await import("@/plugins/llm/tasks");
  assert.ok(isLlmTask("page-assist"));
  assert.equal(LLM_TASKS.find((x) => x.id === "page-assist")?.plugin, "workspace");
});

test("the card is kept by the document (its state whole, also long), never written as Markdown", async () => {
  const d = await import("@/plugins/workspace/doc");
  const state = JSON.stringify({ status: "asking", intent: "x".repeat(3000) });
  const doc = d.sanitizeDoc({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Reise" }] }, { type: "assistCard", attrs: { id: "k3x9", state, evil: 1 } }] });
  assert.deepEqual(doc.content[1], { type: "assistCard", attrs: { id: "k3x9", state } });
  assert.equal(d.sanitizeDoc({ type: "doc", content: [{ type: "assistCard", attrs: { id: "<b>", state: "{}" } }] }).content[0].attrs?.id, "", "an id is a short word");
  assert.equal(d.sanitizeDoc({ type: "doc", content: [{ type: "assistCard", attrs: { state: "nope{" } }] }).content[0].type, "paragraph", "a card without a readable state is dropped");
  assert.equal(d.docToMarkdown(doc).trim(), "Reise", "an agent's Markdown neither shows nor makes one");
});

test("the card's state read back: anything unreadable is a fresh card", async () => {
  const { readAssistState } = await import("@/plugins/workspace/assist-shared");
  assert.equal(readAssistState("{oops").status, "thinking");
  const s = readAssistState(JSON.stringify({ status: "proposing", scope: "page", round: 1, answers: { q1: "3" }, actions: [] }));
  assert.deepEqual([s.status, s.scope, s.round, s.answers.q1], ["proposing", "page", 1, "3"]);
});

test("the period a text is about: the months it names, else the next eight weeks", async () => {
  const { periodOf } = await import("@/plugins/workspace/assist");
  const today = new Date(2026, 9, 29);
  const jan = periodOf("Im Januar 2027 wollte ich Nadine besuchen", today);
  assert.deepEqual([jan.from.getFullYear(), jan.from.getMonth(), jan.from.getDate()], [2027, 0, 1]);
  assert.deepEqual([jan.to.getFullYear(), jan.to.getMonth(), jan.to.getDate()], [2027, 1, 1]);
  const dec = periodOf("im Dezember", today);
  assert.deepEqual([dec.from.getFullYear(), dec.from.getMonth()], [2026, 11], "a month without a year: the next one");
  const none = periodOf("irgendwann", today);
  assert.equal(Math.round((none.to.getTime() - none.from.getTime()) / 86400000), 56);
});

test("understanding: questions checked (bad ones dropped, at most four, choices need options) — a round of asking", async () => {
  const { readAssistAnswer } = await import("@/plugins/workspace/assist");
  const { newAssistState } = await import("@/plugins/workspace/assist-shared");
  const raw = {
    intent: "Reise zu Nadine nach Hamburg",
    summary: "Reise zu Nadine nach Hamburg, Januar 2027 — mit Karla?",
    questions: [
      { id: "days", text: "Wie viele Tage?", kind: "choice", options: ["2", "3", "4", 5] },
      { text: "", kind: "text" },
      { id: "travel", text: "Wie reist du?", kind: "weird", options: [] },
      { id: "sleep", text: "Wo schläfst du?", kind: "multi", options: [] },
      { id: "when", text: "Ab wann?", kind: "date" },
      { id: "extra", text: "Noch was?", kind: "text" },
    ],
    actions: [{ kind: "text", markdown: "ignored while asking" }],
  };
  const s = readAssistAnswer(raw, newAssistState(), check());
  assert.equal(s.status, "asking");
  assert.equal(s.round, 1);
  assert.equal(s.summary, "Reise zu Nadine nach Hamburg, Januar 2027 — mit Karla?");
  assert.deepEqual(s.questions.map((q) => [q.id, q.kind, q.options]), [["days", "choice", ["2", "3", "4", "5"]], ["travel", "text", []], ["sleep", "text", []], ["when", "date", []]]);
  assert.deepEqual(s.actions, [], "no proposal while it asks");

  const last = readAssistAnswer({ ...raw, actions: [{ kind: "text", label: "Packliste", markdown: "- Zahnbürste" }] }, { ...newAssistState(), round: 2 }, check());
  assert.equal(last.status, "proposing", "after two rounds it proposes, whatever it would still ask");
  assert.deepEqual(last.questions, []);
  assert.deepEqual(last.actions, [{ id: "a1", kind: "text", label: "Packliste", markdown: "- Zahnbürste" }]);
});

test("a proposal checked: unknown widgets, bad dates and people that don't exist dropped; appointments over yours flagged", async () => {
  const { cleanActions } = await import("@/plugins/workspace/assist");
  const busy = [{ start: new Date(2027, 0, 16, 14, 0), end: new Date(2027, 0, 16, 15, 0), title: "Zahnarzt" }];
  const actions = cleanActions(
    [
      { kind: "shadowCalendar", label: "Hamburg-Reise", name: "Hamburg-Reise", events: [{ title: "Hamburg", start: "2027-01-15", end: "2027-01-18", allDay: true }, { title: "Zug", start: "2027-01-32T10:00", end: "x" }, { title: "Abfahrt", start: "2027-01-20T09:00", end: "2027-01-20T08:00" }] },
      { kind: "shadowCalendar", name: "Leer", events: [{ title: "", start: "2027-01-01" }] },
      { kind: "todo", text: "[[person:15|Karla]] fragen, ob sie mitkommt", due: "2026-12-01" },
      { kind: "todo", text: "Zug buchen", due: "bald" },
      { kind: "widget", widget: "people.coming", person: 12, config: { limit: 4, evil: "x" } },
      { kind: "widget", widget: "people.coming", person: 99 },
      { kind: "widget", widget: "nope.widget" },
      { kind: "text", markdown: "" },
      { kind: "bomb" },
    ],
    check({ busy }),
  );
  assert.deepEqual(actions.map((a) => a.kind), ["shadowCalendar", "todo", "todo", "widget", "widget"]);
  const cal = actions[0] as Extract<(typeof actions)[number], { kind: "shadowCalendar" }>;
  assert.deepEqual(cal.events, [{ title: "Hamburg", start: "2027-01-15", end: "2027-01-18", allDay: true, conflicts: ["Zahnarzt"] }], "only the valid appointment, flagged");
  assert.deepEqual(actions.map((a) => a.id), ["a1", "a2", "a3", "a4", "a5"]);
  const [, karla, train, nadine, nobody] = actions as Extract<(typeof actions)[number], { kind: "todo" | "widget" }>[];
  assert.deepEqual([karla.kind === "todo" && karla.text, karla.kind === "todo" && karla.due], ["Karla fragen, ob sie mitkommt", "2026-12-01"], "plain names (the person's todos find them by name)");
  assert.equal(train.kind === "todo" && train.due, undefined);
  assert.deepEqual(nadine.kind === "widget" && nadine.config, { person: "Nadine", personId: 12, limit: 4 });
  assert.deepEqual(nobody.kind === "widget" && nobody.config, {}, "a person not known: none (the page's person)");
  assert.equal(cleanActions([{ kind: "todo", text: "x" }], check({ can: { calendar: true, todos: false } })).length, 0, "no Todos plugin: no todos");
});

test("runAssist: one call with the block, the people it names, today and your busy times — then the answers make a proposal", async () => {
  const { nadine, karla } = await setup();
  const ir = await import("@/lib/calendar/ir");
  ir.addEvent(ir.zeffCalendar().id, { title: "Zahnarzt", start: "2027-01-16T14:00", end: "2027-01-16T15:00" });
  const w = await import("@/plugins/workspace/store");
  const block = { type: "paragraph", content: [{ type: "text", text: "Im Januar 2027 wollte ich " }, { type: "zeffRef", attrs: { kind: "person", ref: String(nadine), label: "Nadine" } }, { type: "text", text: " in Hamburg besuchen gehen und vorher abklären ob " }, { type: "zeffRef", attrs: { kind: "person", ref: String(karla), label: "Karla" } }, { type: "text", text: " mitkommen mag." }] };
  const pageId = w.createPage({ title: "Nadine", content: { type: "doc", content: [block] } });
  const { runAssist } = await import("@/plugins/workspace/assist");
  const { newAssistState } = await import("@/plugins/workspace/assist-shared");

  process.env.FAKE_CLAUDE_OUTPUT = JSON.stringify({ intent: "Reise", summary: "Reise zu Nadine nach Hamburg — mit Karla?", questions: [{ id: "days", text: "Wie viele Tage?", kind: "choice", options: ["2", "3"] }], actions: [] });
  const asked = await runAssist(pageId, JSON.stringify(block), newAssistState(), new Date(2026, 9, 29));
  const prompt = fs.readFileSync(promptFile, "utf8");
  assert.match(prompt, /\[\[person:\d+\|Nadine\]\] in Hamburg besuchen/, "the block, with its mentions");
  assert.match(prompt, /Nadine.*Wohnt in Hamburg/, "what is known of the people it names");
  assert.match(prompt, /2026-10-29/, "today");
  assert.match(prompt, /2027-01-16 14:00.*Zahnarzt/, "your busy times in the month it is about");
  assert.equal(asked.status, "asking");
  assert.equal(asked.questions[0].id, "days");

  process.env.FAKE_CLAUDE_OUTPUT = JSON.stringify({ intent: "Reise", summary: "3 Tage Hamburg", questions: [], actions: [{ kind: "todo", label: "Karla fragen", text: "Karla fragen, ob sie mitkommt" }] });
  const proposed = await runAssist(pageId, JSON.stringify(block), { ...asked, answers: { days: "3" } }, new Date(2026, 9, 29));
  assert.match(fs.readFileSync(promptFile, "utf8"), /Wie viele Tage\?.*3/, "the answers go with it");
  assert.equal(proposed.status, "proposing");
  assert.equal(proposed.actions.length, 1);

  process.env.FAKE_CLAUDE_OUTPUT = JSON.stringify({ intent: "", summary: "", questions: [], actions: [] });
  await assert.rejects(runAssist(pageId, null, newAssistState("page"), new Date(2026, 9, 29)), /nothing/i, "nothing to ask, nothing to propose: says so");
});

test("applying: only the chosen actions — a plan calendar with its days (embedded), a todo (linked), a widget, text", async () => {
  await setup();
  const w = await import("@/plugins/workspace/store");
  const pageId = w.createPage({ title: "Plan" });
  const { applyAssist, undoAssist } = await import("@/plugins/workspace/assist");
  const { newAssistState } = await import("@/plugins/workspace/assist-shared");
  const state = {
    ...newAssistState(),
    status: "proposing" as const,
    actions: [
      { id: "a1", kind: "shadowCalendar", label: "Hamburg-Reise", name: "Hamburg-Reise", events: [{ title: "Hamburg", start: "2027-01-15", end: "2027-01-18", allDay: true }, { title: "Zug", start: "2027-01-18T08:00", end: "2027-01-18T11:30" }] },
      { id: "a2", kind: "todo", label: "Karla fragen", text: "Karla fragen, ob sie mitkommt", due: "2026-12-01" },
      { id: "a3", kind: "widget", label: "Mit Nadine", widget: "people.coming", config: {} },
      { id: "a4", kind: "text", label: "Packliste", markdown: "## Packliste\n\n- [ ] Zahnbürste" },
      { id: "a5", kind: "text", label: "Not chosen", markdown: "nope" },
    ],
  } as import("@/plugins/workspace/assist-shared").AssistState;
  const r = await applyAssist(pageId, state, ["a1", "a2", "a3", "a4"]);
  assert.deepEqual(r.nodes.map((n) => n.type), ["calendarEmbed", "taskList", "zeffWidget", "heading", "taskList"]);

  const ir = await import("@/lib/calendar/ir");
  const embed = r.nodes[0].attrs!;
  const cal = ir.listCalendars().find((c) => c.id === embed.calendarId)!;
  assert.deepEqual([cal.name, cal.shadow], ["Hamburg-Reise", true], "a shadow calendar: suggestions, nothing blocked");
  assert.deepEqual([embed.view, embed.day, embed.also], ["week", "2027-01-15", ""]);
  assert.deepEqual(ir.eventsBetween("2027-01-15T00:00", "2027-01-19T00:00").filter((e) => e.calendarId === cal.id).map((e) => e.title).sort(), ["Hamburg", "Zug"]);

  // Its todos: one checklist of the page that feeds the Todo engine (ticked there, the todo is done) — not chips of their own.
  const list = r.nodes[1];
  assert.equal(list.attrs!.engine, true);
  assert.match(String(list.attrs!.listId), /\w+/);
  const item = list.content![0];
  assert.deepEqual([item.type, item.attrs!.checked, item.attrs!.due, item.content![0].content![0].text], ["taskItem", false, "2026-12-01", "Karla fragen, ob sie mitkommt"]);
  assert.deepEqual(r.nodes[2].attrs, { widget: "people.coming", config: "{}", title: "", header: "" });
  assert.deepEqual(r.created.map((c) => c.kind), ["calendar", "list"]);
  assert.equal(r.created[1].ref, list.attrs!.listId, "the list is known by its id (Undo takes it out of the page)");
  assert.match(r.summary, /4/, "how many were set up");

  // Undo on the card: what it made outside the page goes again (the list's todos go with the list leaving the page).
  assert.equal(await undoAssist(r.created), 1);
  assert.equal(ir.listCalendars().some((c) => c.id === cal.id), false);
  assert.equal(await undoAssist([{ kind: "calendar", id: ir.zeffCalendar().id, label: "x" }]), 0, "never a calendar that isn't a shadow one");
});

test("the card's server actions: a step (its state back), apply (the blocks), undo — each says what came of it", async () => {
  await setup();
  const w = await import("@/plugins/workspace/store");
  const pageId = w.createPage({ title: "Plan", content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Packen für Hamburg" }] }] } });
  const a = await import("@/plugins/workspace/actions");
  const { newAssistState } = await import("@/plugins/workspace/assist-shared");
  process.env.FAKE_CLAUDE_OUTPUT = JSON.stringify({ intent: "Packen", summary: "Packliste für Hamburg", questions: [], actions: [{ kind: "text", label: "Packliste", markdown: "- [ ] Schal" }] });
  const step = await a.assistAction(pageId, null, JSON.stringify(newAssistState("page")));
  assert.ok(step.ok, String(!step.ok && step.error));
  assert.equal(step.ok && step.state.status, "proposing");
  const applied = step.ok ? await a.applyAssistAction(pageId, JSON.stringify(step.state), ["a1"]) : null;
  assert.ok(applied?.ok);
  assert.equal(applied?.ok && applied.nodes[0].type, "taskList");
  assert.equal((await a.applyAssistAction(pageId, JSON.stringify(step.ok && step.state), []))?.ok, false, "nothing chosen: says so");
  const undone = await a.undoAssistAction([]);
  assert.deepEqual(undone, { ok: true, undone: 0 });
});

test("asked again: the plan calendar it made is updated (its days replaced, no second calendar or block), widgets already on the page aren't added twice, a widget without a person takes the one the text names", async () => {
  const { cleanActions, applyAssist } = await import("@/plugins/workspace/assist");
  const ir = await import("@/lib/calendar/ir");
  const made = ir.createShadowCalendar("Hamburg-Reise");
  ir.addEvent(made.id, { title: "Option A", start: "2027-01-02", end: "2027-01-04", allDay: true });
  const other = ir.createShadowCalendar("Fremd");
  const c = check({ calendars: new Set([made.id]), onPage: new Set(["people.coming:12"]), defaultPerson: { id: 12, name: "Nadine" } });
  const actions = cleanActions(
    [
      { kind: "shadowCalendar", name: "Hamburg-Reise", calendarId: made.id, events: [{ title: "Hamburg", start: "2027-01-09", end: "2027-01-11", allDay: true }] },
      { kind: "shadowCalendar", name: "Fremd", calendarId: other.id, events: [{ title: "x", start: "2027-01-09", end: "2027-01-10", allDay: true }] },
      { kind: "widget", widget: "people.coming", person: 12 },
      { kind: "widget", widget: "people.coming" },
    ],
    c,
  );
  const [update, fresh] = actions as Extract<(typeof actions)[number], { kind: "shadowCalendar" }>[];
  assert.equal(update.calendarId, made.id, "its own plan calendar: updated");
  assert.equal(fresh.calendarId, undefined, "a calendar it didn't make: never touched (a new one instead)");
  assert.equal(actions.filter((a) => a.kind === "widget").length, 0, "Nadine's widget is on the page already (also the one without a person: it takes Nadine)");
  const lone = cleanActions([{ kind: "widget", widget: "people.coming" }], check({ defaultPerson: { id: 12, name: "Nadine" } }))[0];
  assert.deepEqual(lone.kind === "widget" && lone.config, { person: "Nadine", personId: 12 }, "no person given: the one the text names");

  const w = await import("@/plugins/workspace/store");
  const { newAssistState } = await import("@/plugins/workspace/assist-shared");
  const pageId = w.createPage({ title: "Plan" });
  const state = { ...newAssistState(), status: "proposing" as const, created: [{ kind: "calendar" as const, id: made.id, label: "Hamburg-Reise" }], actions: [{ ...update, id: "a1" }] };
  const r = await applyAssist(pageId, state, ["a1"]);
  assert.deepEqual(r.nodes, [], "its block is on the page already");
  assert.deepEqual(r.created, [], "nothing new made");
  assert.equal(ir.listCalendars().filter((x) => x.name === "Hamburg-Reise").length, 1);
  assert.deepEqual(ir.eventsBetween("2027-01-01T00:00", "2027-01-31T00:00").filter((e) => e.calendarId === made.id).map((e) => [e.title, e.start]), [["Hamburg", "2027-01-09"]], "its days replaced");
});

test("a plan calendar proposes one appointment per time: those overlapping an earlier one are dropped (moved by drag and drop instead)", async () => {
  const { cleanActions } = await import("@/plugins/workspace/assist");
  const [cal] = cleanActions(
    [
      {
        kind: "shadowCalendar",
        name: "Hamburg",
        events: [
          { title: "Option A", start: "2027-01-15", end: "2027-01-18", allDay: true },
          { title: "Option B", start: "2027-01-16", end: "2027-01-19", allDay: true },
          { title: "Zug hin", start: "2027-01-15T08:00", end: "2027-01-15T11:00" },
          { title: "Option C", start: "2027-01-22", end: "2027-01-25", allDay: true },
        ],
      },
    ],
    check(),
  ) as Extract<import("@/plugins/workspace/assist-shared").AssistAction, { kind: "shadowCalendar" }>[];
  assert.deepEqual(cal.events.map((e) => e.title), ["Option A", "Option C"], "B overlaps A, the train lies inside A: one per time");
});

test("the questions: several answers allowed where several can be true (dates, options to compare) — the prompt asks for multi", async () => {
  const { cleanQuestions } = await import("@/plugins/workspace/assist");
  const [q] = cleanQuestions([{ id: "q1", text: "Welche Wochenenden passen?", kind: "choice", options: ["2.–3.1.", "9.–10.1.", "16.–17.1."] }]);
  assert.equal(q.kind, "multi", "dates offered as options: several can be picked");
  const [one] = cleanQuestions([{ id: "q2", text: "Wie reist du?", kind: "choice", options: ["Zug", "Auto"] }]);
  assert.equal(one.kind, "choice", "one way of travel: one answer");
});

test("a text with checklist lines: those lines are todos (the page's one checklist that feeds the engine), the rest stays text", async () => {
  const { cleanActions } = await import("@/plugins/workspace/assist");
  const actions = cleanActions([{ kind: "text", markdown: "Freitag bis Sonntag = 2 Nächte.\n\n- [ ] Karla fragen\n- [ ] Zug buchen" }, { kind: "text", markdown: "- [ ] Nur ein Todo" }], check());
  assert.deepEqual(
    actions.map((a) => (a.kind === "todo" ? `todo:${a.text}` : a.kind === "text" ? `text:${a.markdown}` : a.kind)),
    ["text:Freitag bis Sonntag = 2 Nächte.", "todo:Karla fragen", "todo:Zug buchen", "todo:Nur ein Todo"],
  );
});

test("a page with a todos widget: Think along's todos are Zeff's todos (shown in the widget), no checklist beside it", async () => {
  await setup();
  const w = await import("@/plugins/workspace/store");
  const pageId = w.createPage({ title: "Mit Widget", content: { type: "doc", content: [{ type: "zeffWidget", attrs: { widget: "people.todos", config: "{}", title: "", header: "" } }] } });
  const { applyAssist } = await import("@/plugins/workspace/assist");
  const { newAssistState } = await import("@/plugins/workspace/assist-shared");
  const state = { ...newAssistState(), status: "proposing" as const, actions: [{ id: "a1", kind: "todo" as const, label: "Karla", text: "Karla wegen Hamburg fragen", due: "2026-12-01" }] };
  const r = await applyAssist(pageId, state, ["a1"]);
  assert.deepEqual(r.nodes, [], "nothing put into the page — the widget shows it");
  const { getTodo } = await import("@/lib/todos/store");
  const made = r.created.find((c) => c.kind === "todo")!;
  assert.deepEqual([getTodo(made.id)!.text, getTodo(made.id)!.due, getTodo(made.id)!.status], ["Karla wegen Hamburg fragen", "2026-12-01", "open"]);
});

test("asked through the ✨ composer with a wish: the card keeps it and the AI is told what the user wants", async () => {
  await setup();
  const { readAssistState, newAssistState } = await import("@/plugins/workspace/assist-shared");
  assert.equal(readAssistState(JSON.stringify({ status: "thinking", wish: "Plan the packing" })).wish, "Plan the packing");
  assert.equal(readAssistState(JSON.stringify({ status: "thinking", wish: 3 })).wish, undefined, "no wish: none");
  const w = await import("@/plugins/workspace/store");
  const pageId = w.createPage({ title: "Hamburg", content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Reise nach Hamburg" }] }] } });
  const { runAssist } = await import("@/plugins/workspace/assist");
  process.env.FAKE_CLAUDE_OUTPUT = JSON.stringify({ intent: "Packen", summary: "Packliste", questions: [], actions: [{ kind: "text", label: "Packliste", markdown: "Schal" }] });
  const next = await runAssist(pageId, null, { ...newAssistState("page"), wish: "Eine Packliste, bitte" }, new Date(2026, 9, 29));
  assert.match(fs.readFileSync(promptFile, "utf8"), /Was der Nutzer möchte[\s\S]*Eine Packliste, bitte/);
  assert.equal(next.wish, "Eine Packliste, bitte", "kept for the next step");
  await runAssist(pageId, null, newAssistState("page"), new Date(2026, 9, 29));
  assert.doesNotMatch(fs.readFileSync(promptFile, "utf8"), /Was der Nutzer möchte/, "without a wish: no such part");
});
