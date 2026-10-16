import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();
const ago = (h: number) => new Date(Date.now() - h * 3600e3).toISOString();

/**
 * Rules in a filter step, as Outlook's: a field (by its name — From, Folder, Unread, the title …), a condition (contains,
 * doesn't contain, is, isn't, empty, not empty), a value; all of them or any. And the Mail & Chat plugin's templates: an
 * inbox under Mail (or Chats) in one click — its source the parent, its rules set.
 */
test("filter rules: Outlook's kind, all or any — on any database's fields", async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "outlook-mail", "gmail", "mail-client"]) setInstalled(id, true);
  const m = await import("@/plugins/workspace/model");
  const n = m.normalizePipeline({ steps: [{ id: "f", kind: "filter", match: "any", rules: [{ field: " From ", op: "contains", value: "(Jira)" }, { field: "Unread", op: "is", value: "yes" }, { field: "", op: "contains", value: "x" }, { field: "Folder", op: "nonsense" }] }] });
  assert.deepEqual(n.steps[0].rules, [{ field: "From", op: "contains", value: "(Jira)" }, { field: "Unread", op: "is", value: "yes" }], "a rule needs its field and a known condition");
  assert.equal(n.steps[0].match, "any");

  const { saveMails } = await import("@/lib/mail/store");
  const w = await import("@/plugins/workspace/store");
  const { runPipeline } = await import("@/plugins/workspace/pipeline");
  const { createSourceDatabase } = await import("@/plugins/workspace/derived");
  saveMails([
    { convId: "R1", folder: "Posteingang", from: "Christopher Lorenz (Jira)", fromEmail: "jira@example.com", subject: "[PPJIRA] Updates für PROJ-1", preview: "…", receivedAt: ago(1), unread: true },
    { convId: "R2", folder: "Posteingang", from: "Anna Berg", fromEmail: "anna@example.com", subject: "Kurze Frage", preview: "Hast du Zeit?", receivedAt: ago(2), unread: true },
    { convId: "R3", folder: "Notifications", from: "GitLab", fromEmail: "noreply@gitlab.example", subject: "Pipeline failed", preview: "…", receivedAt: ago(3), unread: false },
  ]);
  const mail = createSourceDatabase("mail");
  await runPipeline(mail, { ai: false });
  const steps = w.getDatabase(mail)!.schema.pipeline!.steps;
  const set = async (rules: unknown[], match: "all" | "any" = "all") => {
    w.updateSchema(mail, { ...w.getDatabase(mail)!.schema, pipeline: { steps: [steps[0], { id: "f", kind: "filter", match, rules } as never] } });
    await runPipeline(mail, { ai: false });
    return w.rawRows(mail).map((r) => r.title).sort();
  };
  assert.deepEqual(await set([{ field: "Folder", op: "is", value: "Posteingang" }]), ["Kurze Frage", "[PPJIRA] Updates für PROJ-1"]);
  assert.deepEqual(await set([{ field: "Folder", op: "is", value: "Posteingang" }, { field: "From", op: "not_contains", value: "(Jira)" }]), ["Kurze Frage"], "all");
  assert.deepEqual(await set([{ field: "From", op: "contains", value: "(jira)" }, { field: "From", op: "contains", value: "noreply" }], "any"), ["Pipeline failed", "[PPJIRA] Updates für PROJ-1"], "any — any case");
  assert.deepEqual(await set([{ field: "Unread", op: "is", value: "no" }]), ["Pipeline failed"], "a checkbox: yes / no");
  assert.deepEqual(await set([{ field: "Title", op: "contains", value: "frage" }]), ["Kurze Frage"], "the title by its name");
});

test("the plugin's templates: an inbox under Mail in one click — its rules set, shown by the mail client", async () => {
  const w = await import("@/plugins/workspace/store");
  const { runPipeline } = await import("@/plugins/workspace/pipeline");
  const { createSourceDatabase } = await import("@/plugins/workspace/derived");
  const { inboxTemplates, createInbox } = await import("@/plugins/mail-client/templates");
  const mail = createSourceDatabase("mail");
  await runPipeline(mail, { ai: false });
  const list = inboxTemplates("mail");
  assert.ok(list.some((x) => x.id === "people") && list.some((x) => x.id === "important"), "people, important (AI) …");
  assert.ok(inboxTemplates("message").some((x) => x.id === "teams"));
  const id = await createInbox(mail, "people");
  const d = w.getDatabase(id)!;
  assert.equal(d.page.parentId, mail, "under Mail");
  assert.equal(d.schema.views[0].app, "mail");
  await runPipeline(id, { ai: false });
  assert.deepEqual(w.rawRows(id).map((r) => r.title), ["Kurze Frage"], "from people: no Jira, no noreply");
});

test("unread counters: every mail database's unread rows — for the sidebar", async () => {
  const w = await import("@/plugins/workspace/store");
  const { runPipeline } = await import("@/plugins/workspace/pipeline");
  const { createSourceDatabase } = await import("@/plugins/workspace/derived");
  const { unreadCounts } = await import("@/plugins/workspace/store");
  const mail = createSourceDatabase("mail");
  await runPipeline(mail, { ai: false });
  const unread = w.rawRows(mail).filter((r) => r.cells.mailunread === true).length;
  assert.ok(unread > 0);
  assert.equal(unreadCounts()[mail], unread);
  const todos = createSourceDatabase("todos");
  assert.equal(unreadCounts()[todos], undefined, "only mail databases");
});

test("a set step: rows matching its rules get a field's value — before it is applied, a preview says which rows", async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "outlook-mail", "mail-client"]) setInstalled(id, true);
  const m = await import("@/plugins/workspace/model");
  const n = m.normalizePipeline({ steps: [{ id: "s", kind: "set", name: " Priority ", setValue: "high", match: "any", rules: [{ field: "From", op: "contains", value: "setter" }] }, { id: "x", kind: "set", name: "", setValue: "v" }] });
  assert.equal(n.steps.length, 1, "a set step needs its field");
  assert.deepEqual([n.steps[0].name, n.steps[0].setValue, n.steps[0].match], ["Priority", "high", "any"]);

  const { saveMails } = await import("@/lib/mail/store");
  const w = await import("@/plugins/workspace/store");
  const { runPipeline, previewSet } = await import("@/plugins/workspace/pipeline");
  const { createSourceDatabase } = await import("@/plugins/workspace/derived");
  saveMails([
    { convId: "S1", folder: "Posteingang", from: "Carla Setter", fromEmail: "carla@setter.example", subject: "Wichtig", preview: "…", receivedAt: ago(1), unread: true },
    { convId: "S2", folder: "Posteingang", from: "Anna Berg", fromEmail: "anna@example.com", subject: "Frage", preview: "…", receivedAt: ago(2), unread: true },
  ]);
  const id = createSourceDatabase("mail");
  await runPipeline(id, { ai: false });
  const steps = [w.getDatabase(id)!.schema.pipeline!.steps[0], { id: "s", kind: "set", name: "Priority", setValue: "high", rules: [{ field: "From", op: "contains", value: "setter" }] } as never];
  assert.deepEqual((await previewSet(id, steps, "s")).map((r) => r.title), ["Wichtig"], "the preview: only the rows it would change");
  assert.equal(w.getDatabase(id)!.schema.properties.some((p) => p.name === "Priority"), false, "a preview changes nothing");
  w.updateSchema(id, { ...w.getDatabase(id)!.schema, pipeline: { steps } });
  await runPipeline(id, { ai: false });
  const d = w.getDatabase(id)!;
  const prop = d.schema.properties.find((p) => p.name === "Priority")!;
  const text = (title: string) => String(w.rawRows(id).find((r) => r.title === title)!.cells[prop.id] ?? "");
  const shown = (title: string) => d.schema.properties.find((p) => p.id === prop.id)?.options?.find((o) => o.id === text(title))?.name ?? text(title);
  assert.equal(shown("Wichtig"), "high");
  assert.equal(shown("Frage"), "", "the others stay empty");
});
