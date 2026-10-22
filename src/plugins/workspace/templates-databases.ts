import { t } from "@/lib/i18n/server";
import { COLORS, newId, newProperty, newView, type DbSchema, type Option, type Property, type View } from "./model";
import { isInstalled } from "@/plugins/state";
import { CONTRACT } from "./contract-fields";
import { addRow, createPage, getDatabase, updateSchema } from "./store";

/**
 * The database templates' make (the Workspace plugin): every name in your language — the database, its fields, its views and
 * choices, the example rows —, the view you work in first (a board where things move, a gallery where they are looked at), the
 * technical columns hidden there, cards that say at a glance what tells the rows apart, and examples that show how it is meant.
 * Card templates name fields by their (translated) names: `{{ [Name] }}`. Server only.
 */

const day = (inDays: number) => new Date(Date.now() + inDays * 864e5).toLocaleDateString("sv-SE");
const select = (name: string, names: string[], colors?: string[]): Property => ({ ...newProperty(name, "select"), options: names.map((n, i): Option => ({ id: newId("o"), name: n, color: colors?.[i] ?? COLORS[(i + 1) % COLORS.length] })) });
const multi = (name: string, names: string[], colors?: string[]): Property => ({ ...newProperty(name, "multi_select"), options: names.map((n, i): Option => ({ id: newId("o"), name: n, color: colors?.[i] ?? COLORS[(i + 3) % COLORS.length] })) });
const view = (name: string, type: View["type"], extra: Partial<View> = {}): View => ({ ...newView(name, type), ...extra });
const euro = (name: string): Property => ({ ...newProperty(name, "number"), format: "euro" as const });
/** A status field: its choices with their colour and group (to do, doing, done — what progress and "open" go by). */
const status = (choices: [string, string, "todo" | "doing" | "done"][], name = t("Status")): Property & { options: Option[] } => ({
  ...newProperty(name, "status"),
  options: choices.map(([n, color, group]) => ({ id: newId("o"), name: n, color, group })),
});
const workStatus = () =>
  status([
    [t("Not started"), "gray", "todo"],
    [t("In progress"), "blue", "doing"],
    [t("Done"), "green", "done"],
  ]);
/** A field's name as a card template writes it. */
const f = (name: string) => `[${name}]`;
const notDone = (p: Property & { options: Option[] }): View["filter"] => ({ op: "and", rules: p.options.filter((o) => o.group === "done").map((o) => ({ prop: p.id, cond: "is_not" as const, value: o.id })) });

export function tasksDatabase(parentId: number | null): number {
  const st = workStatus();
  const due = { ...newProperty(t("Due"), "date"), remind: 2 };
  const priority = select(t("Priority"), [t("Low"), t("Medium"), t("High")], ["gray", "yellow", "red"]);
  const owner = newProperty(t("Owner"), "person");
  const todo = newProperty(t("Zeff todo"), "todo");
  const ticket = newProperty(t("Ticket"), "ticket");
  const card = `<b>{{ title }}</b>\n<row gap=1>{{ ${f(priority.name)} | chip }}<grow/>{{ ${f(due.name)} | relative | muted }}</row>\n{{ ${f(owner.name)} | muted }}`;
  const schema: DbSchema = {
    titleName: t("Task"),
    personProp: owner.id,
    properties: [st, due, priority, owner, todo, ticket],
    views: [
      view(t("Board"), "board", { groupBy: st.id, hidden: [todo.id, ticket.id], card }),
      // The open ones with a date, the earliest (the overdue) first.
      view(t("By due date"), "table", { filter: { op: "and", rules: [...notDone(st).rules, { prop: due.id, cond: "not_empty" }] }, sorts: [{ prop: due.id, dir: "asc" }], hidden: [todo.id, ticket.id] }),
      view(t("All"), "table", { sorts: [{ prop: due.id, dir: "asc" }] }),
      view(t("Calendar"), "calendar", { dateProp: due.id }),
    ],
  };
  const id = createPage({ parentId, title: t("Tasks"), icon: "✅", kind: "database", schema });
  const [todoS, doing] = st.options;
  addRow(id, { title: t("Move a card to In progress"), cells: { [st.id]: doing.id, [priority.id]: priority.options![1].id, [due.id]: day(1) } });
  addRow(id, { title: t("Link a Zeff todo or a Jira ticket"), cells: { [st.id]: todoS.id, [priority.id]: priority.options![2].id, [due.id]: day(3) } });
  addRow(id, { title: t("Type @ in a task to name a person or a page"), cells: { [st.id]: todoS.id, [priority.id]: priority.options![0].id } });
  return id;
}

export function decisionsDatabase(parentId: number | null): number {
  const st = status([
    [t("Proposed"), "yellow", "todo"],
    [t("Decided"), "green", "done"],
    [t("Superseded"), "gray", "done"],
  ]);
  const decided = newProperty(t("Decided on"), "date");
  const who = newProperty(t("Deciders"), "person");
  const area = multi(t("Area"), [t("Product"), t("Tech"), t("Process"), t("Team")]);
  const why = newProperty(t("Why"), "text");
  const ticket = newProperty(t("Ticket"), "ticket");
  const card = `<b>{{ title }}</b>\n{{ ${f(why.name)} | truncate 120 | muted }}\n<row gap=1>{{ ${f(area.name)} | chip }}<grow/>{{ ${f(decided.name)} | date | muted }}</row>`;
  const schema: DbSchema = {
    titleName: t("Decision"),
    personProp: who.id,
    properties: [st, decided, why, who, area, ticket],
    views: [view(t("Log"), "table", { sorts: [{ prop: decided.id, dir: "desc" }], hidden: [ticket.id] }), view(t("By status"), "board", { groupBy: st.id, card })],
  };
  const id = createPage({ parentId, title: t("Decisions"), icon: "⚖️", kind: "database", schema });
  addRow(id, { title: t("We review merge requests within one working day"), cells: { [st.id]: st.options[1].id, [decided.id]: day(-14), [area.id]: [area.options![2].id], [why.id]: t("Waiting on a review was the longest stretch of every ticket.") } });
  addRow(id, { title: t("Design tokens come from one shared file"), cells: { [st.id]: st.options[0].id, [area.id]: [area.options![1].id, area.options![0].id], [why.id]: t("Three places had their own colours — they drifted apart.") } });
  return id;
}

export function readingDatabase(parentId: number | null): number {
  const st = status([
    [t("To read"), "gray", "todo"],
    [t("Reading"), "blue", "doing"],
    [t("Read"), "green", "done"],
  ]);
  const author = newProperty(t("Author"), "text");
  const rating = newProperty(t("Rating"), "number");
  const tags = multi(t("Tags"), [t("Tech"), t("Design"), t("Business"), t("Fiction")]);
  const url = newProperty(t("Link"), "url");
  const card = `<b>{{ title }}</b>\n{{ ${f(author.name)} | muted }}\n<row gap=1>{{ ${f(st.name)} | chip }} {{ ${f(tags.name)} | chip }}</row>\n<row>{{#if ${f(rating.name)}}}{{ ${f(rating.name)} }} ★{{/if}}<grow/>{{ ${f(url.name)} | link }}</row>`;
  const schema: DbSchema = {
    titleName: t("Title"),
    properties: [st, author, rating, tags, url],
    views: [view(t("Shelf"), "board", { groupBy: st.id, card }), view(t("Gallery"), "gallery", { card }), view(t("List"), "table")],
  };
  const id = createPage({ parentId, title: t("Reading list"), icon: "📖", kind: "database", schema });
  addRow(id, { title: "Shape Up", cells: { [st.id]: st.options[2].id, [author.id]: "Ryan Singer", [rating.id]: 5, [tags.id]: [tags.options![2].id], [url.id]: "https://basecamp.com/shapeup" } });
  addRow(id, { title: "Refactoring UI", cells: { [st.id]: st.options[1].id, [author.id]: "Adam Wathan, Steve Schoger", [tags.id]: [tags.options![1].id], [url.id]: "https://www.refactoringui.com" } });
  addRow(id, { title: t("An article you want to read"), cells: { [st.id]: st.options[0].id, [tags.id]: [tags.options![0].id] } });
  return id;
}

/** Projects and their tasks: two linked databases — each project rolls up its tasks' progress and hours; the tasks a board by status. */
export function projectsDatabase(parentId: number | null): number {
  const projects = createPage({ parentId, title: t("Projects"), icon: "🗂️", kind: "database", schema: { titleName: t("Project"), properties: [], views: [view(t("Table"), "table")] } });
  const tasks = createPage({ parentId, title: t("Project tasks"), icon: "☑️", kind: "database", schema: { titleName: t("Task"), properties: [], views: [view(t("Table"), "table")] } });
  const st = workStatus();
  const hours = newProperty(t("Hours"), "number");
  const due = newProperty(t("Due"), "date");
  const owner = newProperty(t("Owner"), "person");
  const project = { ...newProperty(t("Project"), "relation"), relationDb: projects };
  const taskCard = `<b>{{ title }}</b>\n<row gap=1>{{ ${f(project.name)} | chip }}<grow/>{{ ${f(due.name)} | relative | muted }}</row>\n<row>{{ ${f(owner.name)} | muted }}<grow/>{{ ${f(hours.name)} | hours | muted }}</row>`;
  updateSchema(tasks, {
    titleName: t("Task"),
    personProp: owner.id,
    properties: [project, st, due, owner, hours],
    views: [view(t("Board"), "board", { groupBy: st.id, card: taskCard }), view(t("Table"), "table", { sorts: [{ prop: due.id, dir: "asc" }], calcs: { [hours.id]: "sum" } })],
  });
  const phase = status([
    [t("Planned"), "gray", "todo"],
    [t("Running"), "blue", "doing"],
    [t("Done"), "green", "done"],
  ]);
  const back = { ...newProperty(t("Tasks"), "relation"), relationDb: tasks, backOf: project.id };
  const done = { ...newProperty(t("Progress"), "rollup"), format: "percent" as const, rollup: { relation: back.id, property: st.id, fn: "percent_done" as const } };
  const total = { ...newProperty(t("Total hours"), "rollup"), rollup: { relation: back.id, property: hours.id, fn: "sum" as const } };
  const pOwner = newProperty(t("Owner"), "person");
  const pDue = newProperty(t("Due"), "date");
  const card = `<row><b>{{ title }}</b><grow/>{{ ${f(done.name)} | percent }}</row>\n{{ ${f(done.name)} | bar }}\n<row gap=1>{{ ${f(phase.name)} | chip }}<grow/>{{ ${f(pDue.name)} | relative | muted }}</row>\n<row>{{ ${f(pOwner.name)} | muted }}<grow/>{{ ${f(total.name)} | hours | muted }}</row>`;
  updateSchema(projects, {
    titleName: t("Project"),
    personProp: pOwner.id,
    properties: [phase, pOwner, pDue, back, done, total],
    views: [view(t("Cards"), "gallery", { card, filter: notDone(phase) }), view(t("Board"), "board", { groupBy: phase.id, card }), view(t("All"), "table")],
  });
  // An example: a project with three tasks, one done — its progress and hours roll up.
  const p = addRow(projects, { title: t("Website relaunch"), cells: { [phase.id]: phase.options[1].id, [pDue.id]: day(30) } });
  const sts = getDatabase(tasks)!.schema.properties.find((x) => x.id === st.id)!.options!;
  addRow(tasks, { title: t("Collect the requirements"), cells: { [project.id]: [p], [st.id]: sts[2].id, [hours.id]: 3 } });
  addRow(tasks, { title: t("Design the start page"), cells: { [project.id]: [p], [st.id]: sts[1].id, [hours.id]: 5, [due.id]: day(7) } });
  addRow(tasks, { title: t("Go live"), cells: { [project.id]: [p], [st.id]: sts[0].id, [due.id]: day(30) } });
  return projects;
}

/** Instalment plans of your own (without the Finances plugin — with it, its debts database is the place). */
export function instalmentPlansDatabase(parentId: number | null): number {
  const plans = createPage({ parentId, title: t("Instalment plans"), icon: "🧾", kind: "database", schema: { titleName: t("Creditor"), properties: [], views: [view(t("Table"), "table")] } });
  const payments = createPage({ parentId, title: t("Payments"), icon: "💸", kind: "database", schema: { titleName: t("Payment"), properties: [], views: [view(t("Table"), "table")] } });
  const plan = { ...newProperty(t("Plan"), "relation"), relationDb: plans };
  const amount = euro(t("Amount"));
  const paidOn = newProperty(t("Paid on"), "date");
  updateSchema(payments, { titleName: t("Payment"), properties: [plan, amount, paidOn], views: [view(t("Table"), "table", { sorts: [{ prop: paidOn.id, dir: "desc" }], calcs: { [amount.id]: "sum" } })] });
  const back = { ...newProperty(t("Payments"), "relation"), relationDb: payments, backOf: plan.id };
  const total = euro(t("Total"));
  const rate = euro(t("Instalment"));
  const paid = { ...newProperty(t("Paid"), "rollup"), format: "euro" as const, rollup: { relation: back.id, property: amount.id, fn: "sum" as const } };
  const open = { ...newProperty(t("Open"), "formula"), format: "euro" as const, formula: `prop(${JSON.stringify(total.name)}) - prop(${JSON.stringify(paid.name)})` };
  const caseNo = newProperty(t("Case number"), "text");
  const next = { ...newProperty(t("Next due"), "date"), remind: 5 };
  const iban = newProperty("IBAN", "text");
  const st = status([
    [t("Running"), "blue", "doing"],
    [t("Paid off"), "green", "done"],
  ]);
  updateSchema(plans, {
    titleName: t("Creditor"),
    properties: [st, caseNo, total, rate, paid, open, next, iban, back],
    views: [view(t("Running"), "table", { filter: notDone(st), sorts: [{ prop: next.id, dir: "asc" }], calcs: { [rate.id]: "sum", [open.id]: "sum" } }), view(t("Board"), "board", { groupBy: st.id })],
  });
  const p = addRow(plans, { title: t("Example creditor"), cells: { [st.id]: st.options[0].id, [caseNo.id]: "DR II 123/26", [total.id]: 600, [rate.id]: 100, [next.id]: day(20) } });
  addRow(payments, { title: t("Instalment 1"), cells: { [plan.id]: [p], [amount.id]: 100, [paidOn.id]: day(-30) } });
  addRow(payments, { title: t("Instalment 2"), cells: { [plan.id]: [p], [amount.id]: 100, [paidOn.id]: day(0) } });
  return plans;
}

/**
 * What you pay regularly: a month and a year, until when it runs, when to cancel by. The running contracts' sum a month is
 * published as "Fixkosten" (when that name is free) — the Finances plugin's overview counts it in.
 */
export function contractsDatabase(parentId: number | null): number {
  // With the Finances plugin the recurring payments of your statements come in by themselves (its source "recurring" fills the
  // fields of fixed id); what you add — the kind, the provider, when to cancel by — is yours.
  const fromBank = isInstalled("finances");
  const monthly = { ...euro(t("Per month")), id: CONTRACT.monthly };
  const amount = { ...euro(t("Per payment")), id: CONTRACT.amount };
  const rhythm = { ...select(t("Rhythm"), [t("Monthly"), t("Quarterly"), t("Yearly")], ["blue", "violet", "amber"]), id: CONTRACT.rhythm };
  const last = { ...newProperty(t("Last paid"), "date"), id: CONTRACT.last };
  const next = { ...newProperty(t("Next payment"), "date"), id: CONTRACT.next };
  const yearly = { ...euro(t("Per year")), type: "formula" as const, formula: `prop(${JSON.stringify(monthly.name)}) * 12` };
  const until = newProperty(t("Runs until"), "date");
  // A cancellation date: in "Needs attention" a month before.
  const cancel = { ...newProperty(t("Cancel by"), "date"), remind: 30 };
  const customer = newProperty(t("Customer number"), "text");
  const provider = newProperty(t("Provider"), "person");
  const kinds = [t("Insurance"), t("Subscription"), t("Utilities"), t("Phone & internet"), t("Rent"), t("Other")];
  // From the statements: the AI tells what each recurring payment is — a transfer to a person or to an account of your own is
  // no contract (it drops out of the running ones and the fixed costs). By hand: a choice of yours.
  const notContract = t("Not a contract");
  const kind: Property = fromBank
    ? { ...newProperty(t("Kind"), "ai"), aiChoices: [...kinds, notContract], aiPrompt: t("What this regular payment is, by its recipient and amount: an insurance, a subscription, utilities (power, water, heating), phone & internet, rent, something other — or not a contract at all (money to a person, to an account or pocket of my own, savings, a loan paid out).") }
    : select(t("Kind"), kinds);
  const st = status([
    [t("Active"), "green", "doing"],
    [t("Cancelled"), "gray", "done"],
  ]);
  const card = `<row><b>{{ title }}</b><grow/>{{ ${f(monthly.name)} | euro }}</row>\n<row gap=1>{{ ${f(kind.name)} | chip }}<grow/>{{#if ${f(cancel.name)}}}{{ ${f(cancel.name)} | relative | muted }}{{/if}}</row>`;
  const running = view(t("Running"), "table", { filter: fromBank ? { op: "and", rules: [...notDone(st).rules, { prop: kind.id, cond: "is_not", value: notContract }] } : notDone(st), sorts: [{ prop: cancel.id, dir: "asc" }], calcs: { [monthly.id]: "sum", [yearly.id]: "sum" } });
  const schema: DbSchema = {
    titleName: t("Contract"),
    properties: [st, kind, provider, monthly, yearly, amount, rhythm, next, last, cancel, until, customer],
    ...(fromBank ? { pipeline: { steps: [{ id: "srecurring", kind: "source" as const, from: "ext" as const, ext: "recurring" }], everyMinutes: 360 }, review: { on: true } } : {}),
    views: [
      running,
      view(t("By kind"), "board", { groupBy: kind.id, filter: notDone(st), card }),
      view(t("Cancellation dates"), "table", { filter: { op: "and", rules: [...notDone(st).rules, { prop: cancel.id, cond: "not_empty" }] }, sorts: [{ prop: cancel.id, dir: "asc" }] }),
      view(t("All"), "table"),
    ],
  };
  const id = createPage({ parentId, title: t("Contracts"), icon: "📜", kind: "database", schema });
  if (fromBank) void import("./pipeline").then((p) => p.runPipeline(id, { ai: false })).catch(() => undefined);
  else {
    addRow(id, { title: t("Example: mobile phone"), cells: { [st.id]: st.options[0].id, [kind.id]: kind.options![3].id, [monthly.id]: 15, [cancel.id]: day(45) } });
    addRow(id, { title: t("Example: streaming"), cells: { [st.id]: st.options[0].id, [kind.id]: kind.options![1].id, [monthly.id]: 13.99 } });
  }
  void import("./values").then((v) => {
    // (A source beside the others: every contracts database adds its running contracts to the fixed costs.)
    v.publishValue({ label: "Fixkosten", dbId: id, viewId: running.id, propId: monthly.id, fn: "sum" });
  });
  return id;
}
