import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * Open loops (the loops plugin): promises read by the AI (commitment claims) and questions, requests and mentions read by rule —
 * what is open, who owes it, closed by the source itself (a reply of the right side), by the AI with a quote (you confirm) or by
 * you; your decisions in the feedback ledger; agents see only what their clearance allows.
 */

const ago = (h: number) => new Date(Date.now() - h * 3600e3).toISOString();
const dayAgo = (d: number) => ago(d * 24);

type Seeded = { anna: number; rico: number; julia: number; karl: number; claims: Record<string, number> };
let seeded: Seeded | null = null;

async function seed(): Promise<Seeded> {
  if (seeded) return seeded;
  const { getDb, schema } = await import("@/db");
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["people", "loops", "timeline"]) setInstalled(id as never, true);
  const { createPerson, addAccount } = await import("@/plugins/people/store");
  const { setMyName } = await import("@/plugins/people/pulse");
  const { addClaim, claimsOf } = await import("@/plugins/people/graph");
  setMyName("Moritz Roessler");
  const anna = createPerson({ name: "Anna Berg", whatsapp: "Anna" });
  const rico = createPerson({ name: "Rico Clemen" });
  addAccount(rico, "jira", "ricclem");
  const julia = createPerson({ name: "Julia Freidank", emails: ["julia@kunde.de"] });
  const karl = createPerson({ name: "Karl", whatsapp: "Karl" });
  const db = getDb();
  let n = 0;
  const mail = (conv: string, from: string | null, preview: string, at: string, extra: Record<string, unknown> = {}) => {
    const key = `${conv}|h${++n}`;
    const folder = conv.startsWith("wa:") ? "WhatsApp" : conv.startsWith("gmail:") ? (from === "Ich" ? "Gmail · Sent" : "Gmail") : "Posteingang";
    db.insert(schema.emails).values({ key, convId: conv, folder, fromName: from, fromEmail: (extra.email as string) ?? null, subject: (extra.subject as string) ?? conv.slice(3), preview, receivedAt: at, syncedAt: at, isGroup: (extra.group as boolean) ?? false, toMe: (extra.toMe as boolean) ?? false, hasAttachments: (extra.att as boolean) ?? false } as never).run();
    return key;
  };
  // WhatsApp: Anna asks me (no answer) — I owe it.
  mail("wa:Anna", "Anna", "Kannst du mir die Rechnung vom Juli schicken?", dayAgo(2));
  // Bob's question I answered — nothing.
  mail("wa:Bob", "Bob", "Kommst du morgen zum Training?", dayAgo(3));
  mail("wa:Bob", "Ich", "Ja, bin dabei", ago(70));
  // My question to Karl, unanswered — he owes it.
  mail("wa:Karl", "Ich", "Hast du die Schlüssel noch?", dayAgo(1));
  // A group: chatter isn't to me; a question to me is.
  mail("wa:Familie", "Tante Uschi", "Wer bringt Kuchen mit?", dayAgo(1), { group: true });
  mail("wa:Familie", "Tante Uschi", "Moritz, bringst du den Kuchen mit?", ago(20), { group: true, toMe: true });
  // Gmail: Julia asks me to sign (a request); a newsletter's question isn't a loop.
  mail("gmail:t1", "Julia Freidank", "Bitte den Vertrag bis Freitag unterschreiben", dayAgo(1), { email: "julia@kunde.de", subject: "Vertrag" });
  mail("gmail:t2", "Shop News", "Schon gesehen? Neue Angebote!", dayAgo(1), { email: "news@shop.de", subject: "News" });
  // A promise of mine in Anna's chat, then the photos sent — closed by the source.
  const promise = mail("wa:Anna", "Ich", "Ich schick dir morgen die Fotos vom Fest", dayAgo(5));
  mail("wa:Anna", "Ich", "Hier sind die Fotos", dayAgo(4), { att: true });
  // Anna promised a recipe, then only said "Ja gerne" — an acknowledgment delivers nothing.
  const rezept = mail("wa:Anna", "Anna", "Ich schick dir das Rezept noch", dayAgo(3));
  mail("wa:Anna", "Anna", "Ja gerne", ago(30));
  // … and wrote about something else: not the recipe either.
  mail("wa:Anna", "Anna", "Bei uns war heute richtig schönes Wetter am See", ago(28));
  // Julia's thread: my promise of the slides, then a word of mine about them (no attachment) — a proposal, not a close.
  mail("gmail:t3", "Julia Freidank", "Denk an die Folien vom Workshop.", dayAgo(6), { email: "julia@kunde.de", subject: "Workshop" });
  const folien = mail("gmail:t3", "Ich", "Mache ich, die Folien schicke ich dir am Montag", dayAgo(5), { subject: "Re: Workshop" });
  mail("gmail:t3", "Ich", "Die Folien vom Workshop liegen jetzt im Drive: https://drive.example/f", dayAgo(2), { subject: "Re: Workshop" });
  // A promise of mine to Karl, then only "later" — still open.
  const karlPromise = mail("wa:Karl", "Ich", "Ich rufe dich wegen dem Umzug an", dayAgo(6));
  mail("wa:Karl", "Ich", "Melde mich morgen", dayAgo(5));
  // Teams: Rico asks in a chat (no answer); Rico's other question answered by me.
  const tm = (key: string, conv: string, kind: string, sender: string, senderId: string, text: string, at: string) =>
    db.insert(schema.teamsMessages).values({ key, kind, conversationId: conv, messageId: key, sentAt: at, html: "", text, link: `https://teams/${key}`, syncedAt: at, senderName: sender, senderId, place: `Chat with ${sender}` } as never).run();
  tm("c1|1", "c1", "pm", "Rico Clemen", "r1", "Hast du kurz Zeit für das Deployment?", ago(5));
  tm("c2|1", "c2", "pm", "Rico Clemen", "r1", "Kannst du das Review machen?", dayAgo(2));
  tm("c2|2", "c2", "chat", "Moritz Roessler", "me1", "Ja, erledigt", dayAgo(1));
  // Rico promised me the Figma nodes in Teams (a day long past) — no word from him since.
  tm("c3|1", "c3", "pm", "Rico Clemen", "r1", "Ich schicke dir die Figma-Nodes bis Montag", dayAgo(10));
  // A group chat (Rico and Julia): my promise there, then a message of mine about something else — many people talk there: no close by rule.
  tm("c4|1", "c4", "pm", "Rico Clemen", "r1", "Wer schickt mir den Link zum Staging?", dayAgo(4));
  tm("c4|2", "c4", "pm", "Julia Freidank", "j1", "Ich nicht", dayAgo(4));
  tm("c4|3", "c4", "chat", "Moritz Roessler", "me1", "Hier ist der Ablaufplan für morgen früh", dayAgo(3));
  // Jira: a comment addressed to me (open), one I answered after.
  const jc = (id: string, ticket: string, author: string, body: string, at: string) => db.insert(schema.jiraComments).values({ id, ticket, author, at, body } as never).run();
  db.insert(schema.jiraTickets).values({ key: "PC-2", summary: "Navigation", status: "In Arbeit", statusCategory: "inprogress", updatedAt: dayAgo(3) } as never).run();
  db.insert(schema.jiraTickets).values({ key: "PC-3", summary: "Footer", status: "In Arbeit", statusCategory: "inprogress", updatedAt: dayAgo(3) } as never).run();
  db.insert(schema.jiraTickets).values({ key: "PC-4", summary: "Header", status: "Done", statusCategory: "done", updatedAt: dayAgo(1) } as never).run();
  jc("j1", "PC-2", "Rico Clemen", "Hi Moritz, schau bitte mal auf die Navigation", dayAgo(2));
  jc("j2", "PC-3", "Rico Clemen", "Moritz, ist das so gewollt?", dayAgo(3));
  jc("j3", "PC-3", "Moritz Roessler", "Ja, so ist es gewollt.", dayAgo(2));
  jc("j4", "PC-4", "Julia Freidank", "Ich liefere die Texte für den Header.", dayAgo(4));
  // The AI's commitments (as the People extraction keeps them).
  addClaim({ personId: anna, kind: "commitment", text: "Ich schicke Anna die Fotos vom Fest", evidence: "Ich schick dir morgen die Fotos vom Fest", sourceRef: `mail:${promise}`, confidence: 0.9, direction: "mine" });
  addClaim({ personId: karl, kind: "commitment", text: "Ich rufe Karl wegen dem Umzug an", evidence: "Ich rufe dich wegen dem Umzug an", sourceRef: `mail:${karlPromise}`, confidence: 0.7, direction: "mine" });
  addClaim({ personId: rico, kind: "commitment", text: "Rico schickt mir die Figma-Nodes", evidence: "Ich schicke dir die Figma-Nodes bis Montag", sourceRef: "teams:c3|1", confidence: 0.9, direction: "theirs", due: dayAgo(7).slice(0, 10) });
  addClaim({ personId: julia, kind: "commitment", text: "Julia liefert die Header-Texte", evidence: "Ich liefere die Texte für den Header.", sourceRef: "jira-comment:j4", confidence: 0.85, direction: "theirs" });
  addClaim({ personId: julia, kind: "commitment", text: "Ich schicke Julia das Angebot", evidence: "schicke dir das Angebot", sourceRef: "jira-comment:j1", confidence: 0.6, direction: "mine" });
  addClaim({ personId: anna, kind: "commitment", text: "Anna schickt mir das Rezept", evidence: "Ich schick dir das Rezept noch", sourceRef: `mail:${rezept}`, confidence: 0.9, direction: "theirs" });
  addClaim({ personId: rico, kind: "commitment", text: "Ich schicke Rico den Staging-Link", evidence: "Wer schickt mir den Link zum Staging?", sourceRef: "teams:c4|1", confidence: 0.7, direction: "mine" });
  addClaim({ personId: julia, kind: "commitment", text: "Ich schicke Julia die Folien vom Workshop", evidence: "die Folien schicke ich dir am Montag", sourceRef: `mail:${folien}`, confidence: 0.9, direction: "mine" });
  const claims: Record<string, number> = {};
  for (const p of [anna, karl, rico, julia]) for (const c of claimsOf(p)) claims[c.text] = c.id;
  seeded = { anna, rico, julia, karl, claims };
  return seeded;
}

test("the rules: a question, a request, a deferral, a text addressed to you, overdue", async () => {
  const s = await import("@/plugins/loops/shared");
  assert.ok(s.isQuestion("Kommst du morgen?"));
  assert.ok(!s.isQuestion("Siehe https://x.de/a?b=1"));
  assert.ok(s.isRequest("Bitte den Vertrag unterschreiben"));
  assert.ok(s.isRequest("Kannst du das mal prüfen"));
  assert.ok(s.isRequest("Could you review the MR"));
  assert.ok(!s.isRequest("Das Wetter ist schön"));
  assert.ok(s.isDeferral("Melde mich morgen"));
  assert.ok(!s.isDeferral("Hier sind die Fotos"));
  assert.ok(s.isDeferral("Ja gerne"));
  assert.ok(s.sharesTopic("Ich schicke Anna die Fotos vom Fest", "Hier sind die Fotos vom Fest", ["anna"]));
  assert.ok(!s.sharesTopic("Ich schicke Anna die Fotos vom Fest", "Schöne Fotos hast du da", ["anna"]), "one short word in common isn't enough");
  assert.ok(s.sharesTopic("Johanna fragt, ob ich an die Caritas geschrieben habe", "ich hab der Caritas geschrieben", ["johanna"]));
  assert.ok(!s.sharesTopic("Ich schicke Chris am Freitag 150 € zurück", "Was für ein Wetter heute", ["chris"]));
  assert.ok(!s.sharesTopic("Ich schicke Anna morgen die Fotos", "Anna, bis morgen dann", ["anna"]), "names and filler words don't count");
  assert.ok(s.isDeferral("Mach ich"));
  assert.ok(!s.isDeferral("Ja, die Liste ist im Anhang und der Link auch drin"));
  assert.ok(s.addressedTo("Hi Moritz, schau mal", ["moritz roessler"]));
  assert.ok(s.addressedTo("@morrossl kannst du", [], ["morrossl"]));
  assert.ok(s.addressedTo("[~morrossl] bitte", [], ["morrossl"]));
  assert.ok(!s.addressedTo("Hi Moritzi", ["moritz roessler"]));
  const now = new Date("2026-10-22T12:00:00");
  assert.ok(s.isOverdue({ due: "2026-10-21", at: now.toISOString() }, now));
  assert.ok(!s.isOverdue({ due: "2026-10-22", at: now.toISOString() }, now));
  assert.ok(s.isOverdue({ due: "", at: new Date(now.getTime() - 8 * 864e5).toISOString() }, now));
  assert.ok(!s.isOverdue({ due: "", at: new Date(now.getTime() - 2 * 864e5).toISOString() }, now));
});

test("by rule: questions and requests to you nobody answered, yours without an answer, Jira comments addressed to you", async () => {
  await seed();
  const { derivedLoops } = await import("@/plugins/loops/detect");
  const loops = derivedLoops();
  const by = (re: RegExp) => loops.filter((l) => re.test(l.text));
  const one = (re: RegExp) => {
    const hit = by(re);
    assert.equal(hit.length, 1, `one loop for ${re}: ${loops.map((l) => l.text).join(" | ")}`);
    return hit[0];
  };
  const rechnung = one(/Rechnung vom Juli/);
  assert.equal(rechnung.direction, "mine");
  assert.equal(rechnung.kind, "request");
  assert.equal(rechnung.who, "Anna Berg");
  assert.equal(rechnung.source, "whatsapp");
  const keys = one(/Schlüssel/);
  assert.equal(keys.direction, "theirs", "my question: they owe the answer");
  assert.equal(keys.kind, "question");
  assert.equal(one(/bringst du den Kuchen/).direction, "mine");
  assert.equal(by(/Wer bringt Kuchen/).length, 0, "a group's chatter isn't to you");
  assert.equal(by(/Training/).length, 0, "answered");
  const vertrag = one(/Vertrag/);
  assert.equal(vertrag.kind, "request");
  assert.equal(vertrag.personId, (await seed()).julia);
  assert.equal(vertrag.source, "gmail");
  assert.equal(by(/Angebote/).length, 0, "a newsletter's question isn't a loop");
  assert.equal(one(/Deployment/).source, "teams");
  assert.equal(by(/Review machen/).length, 0, "answered in the chat");
  const nav = one(/Navigation/);
  assert.equal(nav.source, "jira");
  assert.equal(nav.direction, "mine");
  assert.equal(by(/so gewollt/).length, 0, "you commented after");
  for (const l of loops) assert.equal(l.origin, "rule");
});

test("closed by the source only where it leaves no doubt (an attachment after a promise to send, a ticket done); a reply about it is a proposal; a 'later', an 'ok', other news or a group's chatter nothing", async () => {
  const s = await seed();
  const { closeByRule } = await import("@/plugins/loops/close");
  const { listLoops } = await import("@/plugins/loops/query");
  const r = closeByRule();
  assert.equal(r.closed, 2, "the photos sent, the header ticket done");
  assert.equal(r.proposed, 1, "the slides: a word of mine about them — proposed, you confirm");
  assert.equal(closeByRule().closed, 0, "once");
  const closed = listLoops({ view: "closed" });
  const fotos = closed.find((l) => l.ref === `claim:${s.claims["Ich schicke Anna die Fotos vom Fest"]}`)!;
  assert.ok(fotos, "listed as closed");
  assert.equal(fotos.closedBy, "rule");
  assert.match(fotos.closeQuote, /Hier sind die Fotos/);
  assert.ok(closed.some((l) => l.ref === `claim:${s.claims["Julia liefert die Header-Texte"]}`));
  const open = listLoops({}).map((l) => l.ref);
  assert.ok(open.includes(`claim:${s.claims["Ich rufe Karl wegen dem Umzug an"]}`), "a 'morgen' doesn't close it");
  assert.ok(open.includes(`claim:${s.claims["Rico schickt mir die Figma-Nodes"]}`));
  assert.ok(open.includes(`claim:${s.claims["Anna schickt mir das Rezept"]}`), "a 'Ja gerne' or other news don't deliver");
  assert.ok(open.includes(`claim:${s.claims["Ich schicke Rico den Staging-Link"]}`), "a group: my next message there isn't the delivery");
  const slides = listLoops({}).find((l) => l.ref === `claim:${s.claims["Ich schicke Julia die Folien vom Workshop"]}`)!;
  assert.equal(slides.state, "open");
  assert.equal(slides.proposal?.by, "rule");
  assert.match(slides.proposal?.quote ?? "", /liegen jetzt im Drive/);
  // The people's own list no longer has it open either.
  const { openCommitments } = await import("@/plugins/people/graph");
  assert.ok(!openCommitments().some((c) => c.id === s.claims["Ich schicke Anna die Fotos vom Fest"]));
});

test("the views: what I owe, what I'm owed, overdue first; a person's loops", async () => {
  const s = await seed();
  const { listLoops } = await import("@/plugins/loops/query");
  const mine = listLoops({ view: "mine" });
  assert.ok(mine.every((l) => l.direction === "mine"));
  assert.ok(mine.some((l) => /Rechnung/.test(l.text)));
  assert.ok(mine.some((l) => /Angebot/.test(l.text)), "an unsure promise is listed (unconfirmed) — recall first");
  const theirs = listLoops({ view: "theirs" });
  assert.ok(theirs.every((l) => l.direction === "theirs"));
  const overdue = listLoops({ view: "overdue" });
  const figma = overdue.find((l) => /Figma/.test(l.text));
  assert.ok(figma, "past its day");
  assert.equal(figma.confirmed, false);
  assert.ok(!overdue.some((l) => /Rechnung/.test(l.text)), "two days old, no day: not yet");
  const all = listLoops({});
  assert.ok(all[0].overdue, "overdue first");
  const ricos = listLoops({ personId: s.rico });
  assert.ok(ricos.length >= 2 && ricos.every((l) => l.personId === s.rico));
});

test("your decisions: dismiss, close, confirm, reopen — each in the feedback ledger (step open-loops)", async () => {
  const s = await seed();
  const { listLoops } = await import("@/plugins/loops/query");
  const { decideLoop } = await import("@/plugins/loops/store");
  const { listFeedback } = await import("@/lib/learning/ledger");
  const { claimsOf } = await import("@/plugins/people/graph");
  const kuchen = listLoops({}).find((l) => /Kuchen/.test(l.text))!;
  assert.equal(decideLoop(kuchen.ref, "dismiss").ok, true);
  assert.ok(!listLoops({}).some((l) => l.ref === kuchen.ref), "gone");
  const figmaRef = `claim:${s.claims["Rico schickt mir die Figma-Nodes"]}`;
  assert.equal(decideLoop(figmaRef, "confirm").ok, true);
  assert.equal(claimsOf(s.rico, { status: ["confirmed"] }).length, 1);
  assert.equal(listLoops({}).find((l) => l.ref === figmaRef)!.confirmed, true);
  assert.equal(decideLoop(figmaRef, "close").ok, true);
  const closed = listLoops({ view: "closed" }).find((l) => l.ref === figmaRef)!;
  assert.equal(closed.closedBy, "you");
  const fotos = `claim:${s.claims["Ich schicke Anna die Fotos vom Fest"]}`;
  assert.equal(decideLoop(fotos, "reopen").ok, true);
  assert.ok(listLoops({}).some((l) => l.ref === fotos), "open again");
  const slides = `claim:${s.claims["Ich schicke Julia die Folien vom Workshop"]}`;
  assert.equal(decideLoop(slides, "reject-close").ok, true);
  assert.equal(listLoops({}).find((l) => l.ref === slides)!.proposal, null);
  const { closeByRule } = await import("@/plugins/loops/close");
  assert.equal(closeByRule().proposed, 0, "a proposal you rejected isn't made again");
  const fb = listFeedback({ step: "open-loops" });
  assert.deepEqual(fb.filter((f) => f.itemRef === slides).map((f) => `${f.verdict}:${f.kind}`), ["rejected:close:rule"]);
  const of = (ref: string) => fb.filter((f) => f.itemRef === ref).map((f) => `${f.verdict}:${f.kind}`);
  assert.deepEqual(of(kuchen.ref), ["rejected:question:mine"]);
  assert.deepEqual(of(figmaRef).sort(), ["accepted:commitment:theirs", "accepted:commitment:theirs"]);
  assert.deepEqual(of(fotos), ["rejected:close:rule"], "a wrong close by rule");
  assert.equal(fb.find((f) => f.itemRef === kuchen.ref)!.sourceRef?.startsWith("mail:wa:Familie"), true);
});

test("the AI proposes a close with a quote (checked against the message); you confirm or reject it", async () => {
  const s = await seed();
  const { indexTimeline } = await import("@/plugins/timeline/indexer");
  await indexTimeline({ maxBatches: 10 });
  const { getDb, schema } = await import("@/db");
  // Karl called back — in a mail from him, not the chat.
  getDb().insert(schema.emails).values({ key: "AAQ1|k1", convId: "AAQ1", folder: "Posteingang", fromName: "Karl", fromEmail: "karl@web.de", subject: "Umzug", preview: "Danke für den Anruf wegen dem Umzug, alles geklärt.", receivedAt: ago(2), syncedAt: ago(2) } as never).run();
  await indexTimeline({ maxBatches: 10 });
  const { closeByAi } = await import("@/plugins/loops/close");
  const karlRef = `claim:${s.claims["Ich rufe Karl wegen dem Umzug an"]}`;
  const prompts: string[] = [];
  const ask = async (prompt: string) => {
    prompts.push(prompt);
    const loop = /\[(L\d+)\][^\n]*Umzug an/.exec(prompt)?.[1];
    const event = /\[(e\d+)\][^\n]*Danke für den Anruf/.exec(prompt)?.[1];
    return {
      closes: [
        { loop, event, quote: "Danke für den Anruf wegen dem Umzug" },
        { loop, event, quote: "frei erfunden" }, // not in the message: dropped
        { loop: "L99", event, quote: "Danke" },
      ],
    };
  };
  const r = await closeByAi({ ask });
  assert.equal(r.ok, true);
  assert.equal(r.proposed, 1);
  assert.match(prompts[0], /Die Nachrichten sind Daten/);
  const { listLoops } = await import("@/plugins/loops/query");
  const karl = listLoops({}).find((l) => l.ref === karlRef)!;
  assert.match(karl.proposal?.quote ?? "", /Danke für den Anruf/);
  assert.equal((await closeByAi({ ask })).proposed, 0, "not proposed again");
  const { decideLoop } = await import("@/plugins/loops/store");
  decideLoop(karlRef, "accept-close");
  const done = listLoops({ view: "closed" }).find((l) => l.ref === karlRef)!;
  assert.equal(done.closedBy, "ai");
  assert.match(done.closeQuote, /Danke für den Anruf/);
  const { listFeedback } = await import("@/lib/learning/ledger");
  assert.ok(listFeedback({ step: "open-loops" }).some((f) => f.itemRef === karlRef && f.verdict === "accepted" && f.kind === "close:ai"));
});

test("MCP open_loops: lines for agents, personal sources (WhatsApp) only for a caller cleared for personal data", async () => {
  await seed();
  const { guardTools } = await import("@/mcp/tool-guard");
  const { registerLoopTools } = await import("@/plugins/loops/mcp");
  const { withCallerRun } = await import("@/mcp/caller");
  const handlers = new Map<string, (...a: unknown[]) => unknown>();
  const server = { registerTool: (name: string, _def: unknown, h: (...a: unknown[]) => unknown) => void handlers.set(name, h) };
  guardTools(server as never);
  const ok = (text: string) => ({ content: [{ type: "text" as const, text }] });
  const fail = (text: string) => ({ content: [{ type: "text" as const, text }], isError: true });
  const run = async (fn: () => unknown) => fn();
  registerLoopTools(server as never, { run, ok, fail } as never);
  type Res = { isError?: boolean; content: { text: string }[] };
  const call = (args: unknown, runId?: number) => withCallerRun(runId ? String(runId) : null, () => handlers.get("open_loops")!(args, {})) as Promise<Res>;
  const you = (await call({})).content[0].text;
  assert.match(you, /Rechnung/, "WhatsApp: you see it");
  assert.match(you, /Navigation/);
  const worker = (await call({}, 8999)).content[0].text;
  assert.ok(!/Rechnung/.test(worker), "WhatsApp is personal: not for a worker cleared for open data only");
  assert.match(worker, /Navigation/, "Jira is open");
  assert.match(worker, /hidden/i, "says that some are left out");
  const theirs = (await call({ direction: "theirs" })).content[0].text;
  assert.ok(!/Navigation/.test(theirs));
  const { setSourceLabel } = await import("@/lib/boundaries");
  setSourceLabel("jira", "secret");
  assert.ok(!/Navigation/.test((await call({})).content[0].text), "secret: not even you over the MCP");
  setSourceLabel("jira", null);
});

test("the extraction is told what counts as a loop: questions to me, review and signature requests, my questions they owe an answer to", async () => {
  const { INSTRUCTIONS } = await import("@/plugins/people/extract");
  assert.match(INSTRUCTIONS, /Unterschrift/);
  assert.match(INSTRUCTIONS, /Frage an mich/);
  assert.match(INSTRUCTIONS, /auf deren Antwort ich warte/);
});
