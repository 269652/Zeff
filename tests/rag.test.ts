import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

const now = () => new Date().toISOString();

let seeded = false;
async function seed() {
  if (seeded) return;
  seeded = true;
  const { getDb, schema } = await import("@/db");
  const db = getDb();
  db.insert(schema.emails).values({ key: "m1", convId: "c1", subject: "Rückfrage zur Navigation-Story", preview: "Gallery Thumbs oder ausgelagert? Bitte um Antwort.", receivedAt: now(), syncedAt: now(), fromName: "Christopher Lorenz" } as never).run();
  db.insert(schema.teamsMessages).values({ key: "t1", kind: "chat", conversationId: "x", messageId: "1", sentAt: now(), html: "", text: "Navigation-Story: bitte erst nach dem Refinement bauen", link: "https://teams/x", syncedAt: now(), senderName: "Rico Clemen" } as never).run();
  db.insert(schema.gitlabItems).values({ key: "g1", kind: "comment", project: "p", projectUrl: "u", ref: "!168", title: "Merge-Konflikt Videohub", body: "Der Merge-Konflikt entsteht in der Migration", url: "https://git/x", syncedAt: now(), author: "Nikolai" } as never).run();
  db.insert(schema.jiraComments).values({ id: "j1", ticket: "RG-1", author: "Moritz Roessler", at: now(), body: "Gallery (Thumbs-Variante) ist umgesetzt, Navigation fehlt" } as never).run();
  db.insert(schema.contexts).values({ kind: "note", title: "Notiz", author: "Ich", body: "Navigation-Story war Wunsch von Julia", links: "[]", ticket: "RG-1" } as never).run();
  db.insert(schema.facts).values({ subject: "Refinement", text: "Das Refinement der Navigation steht in navigation.md", createdAt: now(), updatedAt: now() } as never).run();
}

test("retrieve looks through every source for what the AI asked for — each hit with its reference", async () => {
  await seed();
  const { retrieve } = await import("@/lib/rag");
  const r = await retrieve([{ query: "Navigation-Story Refinement" }], { knowledge: async () => [{ title: "Navigation Guidelines", snippet: "Navigation wird im Refinement festgelegt." }] });
  const sources = new Set(r.hits.map((h) => h.source));
  for (const s of ["mails", "teams", "jira", "notes", "facts", "knowledge"]) assert.ok(sources.has(s as never), `${s} is searched`);
  assert.ok(r.hits.some((h) => h.ref === "mail:m1"));
  assert.ok(r.hits.some((h) => h.ref === "teams:t1"));
  assert.ok(r.hits.some((h) => h.ref === "jira-comment:j1"));
  assert.match(r.text, /\[mail:m1\]/);
  assert.match(r.text, /Rico Clemen/);
  // Where the words are in no source: nothing.
  assert.deepEqual((await retrieve([{ query: "Kubernetes Operator Zertifikat" }], { knowledge: async () => [] })).hits, []);
});

test("a need can name the sources to look in; GitLab is found by its words; the answer is capped", async () => {
  await seed();
  const { retrieve } = await import("@/lib/rag");
  const only = await retrieve([{ query: "Merge-Konflikt Migration", where: ["gitlab"] }], { knowledge: async () => [{ title: "nope", snippet: "Merge-Konflikt Migration" }] });
  assert.deepEqual([...new Set(only.hits.map((h) => h.source))], ["gitlab"]);
  const small = await retrieve([{ query: "Navigation" }], { knowledge: async () => [], maxChars: 200 });
  assert.ok(small.text.length <= 400);
});

test("askWithRetrieval: the AI asks for missing context, Zeff fetches it, the AI answers with it — and gets one chance per round", async () => {
  const { askWithRetrieval } = await import("@/lib/rag");
  const prompts: string[] = [];
  const schemas: object[] = [];
  const fetched: string[] = [];
  const r = await askWithRetrieval<{ answer: string }>({
    prompt: "FRAGE",
    schema: { type: "object", required: ["answer"], properties: { answer: { type: "string" } } },
    ask: async (prompt, schema) => {
      prompts.push(prompt);
      schemas.push(schema);
      return prompts.length === 1 ? { answer: "", needs: [{ query: "Refinement Navigation" }] } : { answer: "Steht in navigation.md" };
    },
    retrieve: async (needs) => (fetched.push(...needs.map((n) => n.query)), { text: "[fact:1] Refinement — navigation.md", hits: [] }),
  });
  assert.equal(r.answer, "Steht in navigation.md");
  assert.deepEqual(fetched, ["Refinement Navigation"]);
  assert.match(prompts[1], /\[fact:1\] Refinement — navigation\.md/);
  assert.ok("needs" in (schemas[0] as { properties: object }).properties, "round 1 may ask for more");
  assert.ok(!("needs" in (schemas[1] as { properties: object }).properties), "the last round must answer");
  assert.equal(prompts.length, 2);
});

test("askWithRetrieval: no needs, no lookup; the same need isn't fetched twice", async () => {
  const { askWithRetrieval } = await import("@/lib/rag");
  let lookups = 0;
  const retrieve = async () => (lookups++, { text: "x", hits: [] });
  const first = await askWithRetrieval<{ answer: string }>({ prompt: "p", schema: { type: "object", properties: { answer: { type: "string" } } }, ask: async () => ({ answer: "fertig" }), retrieve });
  assert.equal(first.answer, "fertig");
  assert.equal(lookups, 0);
  let calls = 0;
  const again = await askWithRetrieval<{ answer: string }>({
    prompt: "p",
    rounds: 3,
    schema: { type: "object", properties: { answer: { type: "string" } } },
    ask: async () => (++calls < 3 ? { answer: "", needs: [{ query: "same" }] } : { answer: "ok" }),
    retrieve,
  });
  assert.equal(again.answer, "ok");
  assert.equal(lookups, 1);
});

test("agents over MCP can ask for missing context themselves: search_context looks through all of Zeff's data", async () => {
  await seed();
  const { registerZeffTools } = await import("@/mcp/server");
  const tools: Record<string, (a: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>> = {};
  registerZeffTools({ registerTool: (name: string, _c: unknown, fn: never) => void (tools[name] = fn) } as never);
  assert.ok(tools.search_context, "the tool is there");
  const r = await tools.search_context({ query: "Navigation Story Refinement" });
  const text = r.content.map((c) => c.text).join("\n");
  assert.match(text, /\[mail:m1\]/);
  assert.match(text, /\[teams:t1\]/);
  assert.match(text, /Rico Clemen/);
  const none = await tools.search_context({ query: "Kubernetes Operator Zertifikat" });
  assert.match(none.content[0].text, /Nothing found/);
});
