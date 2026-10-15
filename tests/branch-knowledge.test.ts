import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

const ago = (days: number) => new Date(Date.now() - days * 864e5).toISOString();

test("short names: the first meaningful words of a change — no stop words, ticket keys or links", async () => {
  const { suggestSlug, SHORT_NAME_MAX } = await import("@/lib/work/branch-knowledge");
  assert.equal(suggestSlug("Footer-Link im Newsletter einrücken, siehe PROJ-339 https://x.example/y"), "footer-link-newsletter");
  assert.equal(suggestSlug("Die Übersichtsseite lädt zu langsam"), "uebersichtsseite-laedt");
  assert.ok(suggestSlug("Konfigurationsverwaltungsoberfläche anpassen").length <= SHORT_NAME_MAX);
  assert.equal(suggestSlug("Quote Variante Startseite Figma Maße", 40, 2), "quote-variante");
  assert.equal(suggestSlug("das ist ein"), "");
});

test("branch knowledge: what the briefing's AI read is kept with its message — a change for its ticket, a rule for its whole project — and stays when the message is gone", async () => {
  const { getDb, schema, getSqlite } = await import("@/db");
  const { addArtifact, artifactsFor, keepFromBriefing, listArtifacts, deleteArtifact, branchKnowledgeDocs } = await import("@/lib/work/branch-knowledge");
  getDb()
    .insert(schema.teamsMessages)
    .values({ key: "proj|2", kind: "chat", conversationId: "proj", messageId: "2", sentAt: ago(3), html: "", text: "Der Ticket-Titel ist nicht zwingend der Code Change. Lieber den Branch nach Code Change shorten lassen.", link: "l", syncedAt: ago(0), senderName: "Christopher Lorenz", place: "PROJ Devs" } as never)
    .run();

  // As the briefing hands them over (cleaned in run.ts): per ticket.
  const n = keepFromBriefing([
    { key: "PROJ-364", branchKnowledge: [{ kind: "rule", text: "Der Branch-Name beschreibt den Code Change, nicht den Ticket-Titel.", ref: "teams:proj|2" }] },
    { key: "PROJ-306", branchKnowledge: [{ kind: "change", text: "Quote-Variante der Startseite mit Figma-Maßen" }, { kind: "change", text: "  " }] },
  ]);
  assert.equal(n, 2, "an empty one isn't kept");
  assert.equal(addArtifact({ ticket: "proj-306", kind: "change", text: "quote-variante der startseite mit figma-maßen" }), null, "the same once");

  assert.deepEqual(artifactsFor("PROJ-306").map((a) => [a.kind, a.ticket]).sort(), [["change", "PROJ-306"], ["rule", "PROJ-364"]], "its own change, and the project's rule");
  assert.deepEqual(artifactsFor("PROJ-999").map((a) => a.kind), ["rule"], "another ticket of the project: the rule only");
  assert.deepEqual(artifactsFor("ABC-1"), [], "another project: nothing");

  const rule = listArtifacts().find((a) => a.kind === "rule")!;
  assert.deepEqual(rule.tags, ["branch-naming", "convention", "PROJ-364"]);
  assert.match(rule.source!.label, /Christopher Lorenz in „PROJ Devs“/);

  // The message goes from the sync: the artifact keeps what it said.
  getSqlite().prepare("delete from teams_messages").run();
  assert.match(artifactsFor("PROJ-306").find((a) => a.kind === "rule")!.source!.text, /Lieber den Branch nach Code Change/);

  const docs = branchKnowledgeDocs("http://zeff");
  assert.equal(docs.length, 2);
  assert.equal(docs[0].space, "Zeff · Branch-Kontext");
  assert.match(docs.find((d) => d.title.startsWith("Branch-Regel"))!.body, /^Tags: branch-naming, convention, PROJ-364/);

  deleteArtifact(rule.id);
  assert.equal(listArtifacts().length, 1);
});

test("the branch name is always there: feature/PROJ-432-fileadmin-relations — from a kept change, else the todo's words, else the ticket's title; the limits and your words follow the settings", async () => {
  const { addArtifact } = await import("@/lib/work/branch-knowledge");
  const { addManualTodo, addSessionTodo, getTodo } = await import("@/lib/boards/store");
  const { setStepPrefs } = await import("@/lib/boards/context-prefs");
  const { namingBlock, namingLimits, branchNameFor, proposeBranchName } = await import("@/lib/work/branch-naming");
  const todo = getTodo(addManualTodo({ ticket: "XYZ-5", text: "Fileadmin Relations auf die neue Struktur umstellen" }).id)!;

  // Nothing kept: the todo's words make the name. The block has the rule and the limits only.
  assert.deepEqual(branchNameFor(todo), { name: "feature/XYZ-5-fileadmin-relations", from: "todo", text: todo.text });
  let block = namingBlock(todo);
  assert.match(block, /Branch-Benennung \(Tag branch-naming, XYZ-5\)/);
  assert.match(block, /2–3 kleingeschriebene Wörter, höchstens 24 Zeichen/);
  assert.match(block, /nicht der Kundenname/);
  assert.doesNotMatch(block, /Festgehalten/);

  // A session's placeholder names the todo it is about by number: that todo's words count, not the instruction's.
  const session = addSessionTodo({ ticket: "XYZ-5", text: `Schließe du Umsetzung von ${todo.ref} vollständig ab so dass XYZ-5 erledigt ist` });
  assert.equal(proposeBranchName(getTodo(session.id)!), "feature/XYZ-5-fileadmin-relations");

  // Kept by the briefing's AI: that change names the branch; the rule is told.
  addArtifact({ ticket: "XYZ-5", kind: "change", text: "Navigationsmenü auf Mobilgeräten überarbeiten" });
  addArtifact({ ticket: "XYZ-5", kind: "rule", text: "Branch-Namen kurz halten." });
  assert.equal(branchNameFor(todo)!.from, "kept");
  assert.equal(proposeBranchName(todo), "feature/XYZ-5-navigationsmenue");
  assert.equal(proposeBranchName({ ...todo, kind: "fix" }), "fix/XYZ-5-navigationsmenue");
  block = namingBlock(todo);
  assert.match(block, /- Code Change: Navigationsmenü auf Mobilgeräten überarbeiten/);
  assert.match(block, /- Regel: Branch-Namen kurz halten\./);
  assert.doesNotMatch(block, /Fileadmin Relations/, "the todo's words are not context, only the name's source");

  // Without any words of its own, the ticket's title: last.
  const { getDb, schema } = await import("@/db");
  getDb().insert(schema.jiraTickets).values({ key: "XYZ-6", summary: "Suche: Filter nach Datum", status: "Open", updatedAt: ago(0) } as never).run();
  assert.equal(proposeBranchName({ ticket: "XYZ-6", kind: "todo", text: "Das ist ein" } as never), "feature/XYZ-6-suche-filter-datum");
  assert.equal(proposeBranchName({ ticket: "", kind: "todo", text: "Etwas" } as never), null, "no ticket: no name");

  // Prompts → Branch names: lengths and your own words.
  setStepPrefs("branchname", { numbers: { maxChars: 14, words: 2 }, extra: "Immer auf Englisch benennen." });
  assert.equal(namingLimits().de, "2 kleingeschriebene Wörter, höchstens 14 Zeichen");
  assert.equal(namingLimits().en, "2 lowercase words, max 14 characters");
  assert.match(namingBlock(todo), /Immer auf Englisch benennen\./);
  assert.equal(proposeBranchName(todo), "feature/XYZ-5-navigationsmen", "cut to the characters set");
});

test("the worker's brief for a new branch asks for a short name and carries what is kept", async () => {
  const { taskFor } = await import("@/lib/work/brief");
  const { listTodos } = await import("@/lib/boards/store");
  const todo = listTodos({ status: "all" })[0];
  const task = taskFor("code", { todo, runId: 1, repo: "/r", cwd: "/w", branch: "feature/PROJ-364-w1", base: "main", isolation: "worktree", linked: [], newBranch: "feature/PROJ-364-<short-change>", branchKnowledge: "\n\n## Branch-Benennung (Tag branch-naming)\n- gemerkt" });
  assert.match(task, /kleingeschriebene Wörter/);
  assert.match(task, /höchstens \d+ Zeichen/);
  assert.match(task, /Branch-Benennung/);
});

test("the briefing's answer: branch knowledge is cleaned — a kind, a text, a ref only of a kind of message", async () => {
  const { cleanResult } = await import("@/lib/boards/run");
  const ticket = { key: "PROJ-1", analyzed: true } as never;
  const r = cleanResult(
    {
      lede: "x",
      left: [],
      tickets: [
        {
          key: "PROJ-1",
          attention: "ready",
          lead: "l",
          summary: "s",
          happened: [],
          todos: [],
          resolved: [],
          flags: [],
          branchKnowledge: [
            { kind: "rule", text: " Kurz halten. ", ref: "teams:abc" },
            { kind: "nonsense", text: "Footer einrücken", ref: "https://evil" },
            { kind: "change", text: "" },
          ],
        },
      ],
    } as never,
    [ticket],
  );
  assert.deepEqual(r.tickets[0].branchKnowledge, [
    { kind: "rule", text: "Kurz halten.", ref: "teams:abc" },
    { kind: "change", text: "Footer einrücken" },
  ]);
});
