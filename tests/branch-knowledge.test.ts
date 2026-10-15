import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

const ago = (days: number) => new Date(Date.now() - days * 864e5).toISOString();

test("short names: the first meaningful words of the message — no stop words, ticket keys or links", async () => {
  const { suggestSlug, SHORT_NAME_MAX } = await import("@/lib/work/branch-knowledge");
  assert.equal(suggestSlug("Bitte den Footer-Link im Newsletter einrücken, siehe PROJ-339 https://x.example/y"), "footer-link-newsletter");
  assert.equal(suggestSlug("Die Übersichtsseite lädt zu langsam"), "uebersichtsseite-laedt");
  assert.ok(suggestSlug("Ein sehr langes Wort Konfigurationsverwaltungsoberfläche anpassen").length <= SHORT_NAME_MAX);
  assert.equal(suggestSlug("das ist ein"), "");
});

test("branch knowledge: a todo and its Teams message are kept, tagged — and found by ticket when the todo is done and the message gone", async () => {
  const { getDb, schema, getSqlite } = await import("@/db");
  const { addFollowUp, listTodos, setTodoStatus } = await import("@/lib/boards/store");
  const { ensureBranchKnowledge, branchKnowledgeFor, branchKnowledgeBlock, branchKnowledgeDocs, BRANCH_TAG } = await import("@/lib/work/branch-knowledge");
  getDb()
    .insert(schema.teamsMessages)
    .values({ key: "c|1", kind: "chat", conversationId: "c", messageId: "1", sentAt: ago(2), html: "", text: "Kannst du den Footer-Link im Newsletter einrücken? Der hängt links am Rand.", link: "l", syncedAt: ago(0), senderName: "Rico Clemen", place: "PROJ Devs" } as never)
    .run();
  const todo = addFollowUp({ ticket: "PROJ-364", text: "Footer-Link im Newsletter einrücken", kind: "clarify", parentId: null as unknown as number, workRunId: null, source: "test", target: "teams:c|1" } as never);
  assert.ok(ensureBranchKnowledge() >= 1);
  assert.equal(ensureBranchKnowledge(), 0, "unchanged: nothing again");
  const [a] = branchKnowledgeFor({ ticket: "PROJ-364" });
  assert.ok(a.tags.includes(BRANCH_TAG) && a.tags.includes("PROJ-364") && a.tags.includes("teams"));
  assert.match(a.body, /Rico Clemen/);
  assert.match(a.body, /Footer-Link im Newsletter einrücken/);
  assert.match(a.slug, /^footer-link/);

  // The todo is done and the message is gone: the artifact stays, with what the message said.
  setTodoStatus(todo.id, "done" as never);
  getSqlite().prepare("delete from teams_messages").run();
  ensureBranchKnowledge();
  const still = branchKnowledgeFor({ ticket: "PROJ-364" });
  assert.equal(still.length, 1);
  assert.match(still[0].body, /hängt links am Rand/);

  // A worker naming a branch for another todo of the ticket is told.
  const next = addFollowUp({ ticket: "PROJ-364", text: "Mobile prüfen", kind: "check", parentId: null as unknown as number, workRunId: null, source: "test" } as never);
  const block = branchKnowledgeBlock(listTodos({ status: "all" }).find((t) => t.id === next.id)!);
  assert.match(block, /Wissen zur Branch-Benennung/);
  assert.match(block, /hängt links am Rand/);
  assert.match(block, /höchstens 24 Zeichen/);
  assert.match(block, /Kurzname-Vorschlag: `footer-link/);
  // Another ticket gets nothing of it.
  const other = addFollowUp({ ticket: "PROJ-999", text: "Etwas anderes tun", kind: "clarify", parentId: null as unknown as number, workRunId: null, source: "test" } as never);
  assert.doesNotMatch(branchKnowledgeBlock(listTodos({ status: "all" }).find((t) => t.id === other.id)!), /hängt links am Rand/);

  // The knowledge server gets the artifact as a page, the tags in its text.
  const docs = branchKnowledgeDocs("http://zeff");
  const page = docs.find((d) => d.id === `zeff:branchctx:${todo.id}`)!;
  assert.equal(page.space, "Zeff · Branch-Kontext");
  assert.match(page.body, /^Tags: branch-naming, PROJ-364/);
});

test("the worker's brief for a new branch asks for a short name and carries what is kept", async () => {
  const { taskFor } = await import("@/lib/work/brief");
  const { listTodos } = await import("@/lib/boards/store");
  const todo = listTodos({ status: "all" })[0];
  const task = taskFor("code", { todo, runId: 1, repo: "/r", cwd: "/w", branch: "feature/PROJ-364-w1", base: "main", isolation: "worktree", linked: [], newBranch: "feature/PROJ-364-<short-change>", branchKnowledge: "\n\n## Wissen zur Branch-Benennung (Tag branch-naming)\n- gemerkt" });
  assert.match(task, /2–3 kleingeschriebene Wörter/);
  assert.match(task, /höchstens 24 Zeichen/);
  assert.match(task, /Wissen zur Branch-Benennung/);
});

test("the branch a worker starts on is named from what is kept: feature/<ticket>-<short name> — the todo the instruction names counts most", async () => {
  const { getDb, schema } = await import("@/db");
  const { addManualTodo, addSessionTodo, getTodo } = await import("@/lib/boards/store");
  const { proposeBranchName } = await import("@/lib/work/branch-knowledge");
  getDb()
    .insert(schema.jiraComments)
    .values({ id: "bk-1", ticket: "PROJ-306", author: "Christopher Lorenz", at: ago(1), body: "Bitte die Quote-Variante der Startseite mit den Figma-Maßen umsetzen." } as never)
    .run();
  const real = addManualTodo({ ticket: "PROJ-306", text: "Quote-Variante der Startseite umsetzen" });
  getDb().update(schema.todos).set({ refs: JSON.stringify(["jira-comment:bk-1"]) } as never).run();
  const session = addSessionTodo({ ticket: "PROJ-306", text: `Schließe du Umsetzung von ${real.ref} vollständig ab so dass PROJ-306 erledigt ist` });
  const name = proposeBranchName(getTodo(session.id)!);
  assert.match(name ?? "", /^feature\/PROJ-306-quote-variante$/, "from the named todo (with Christopher's comment behind it), not from the instruction's words");
  assert.ok((name ?? "").length <= "feature/PROJ-306-".length + 24);
  assert.equal(proposeBranchName({ ...getTodo(session.id)!, ticket: "" }), null, "no ticket: no name");
});
