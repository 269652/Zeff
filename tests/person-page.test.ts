import assert from "node:assert/strict";
import test from "node:test";
import { vnodeToString, type VNode } from "../src/plugins/workspace/card-template";
import { renderView } from "../src/plugins/workspace/view-template";
import type { Row } from "../src/plugins/workspace/model";
import { PERSON_PAGE } from "../src/plugins/people/row-template.meta";
import { personPageData, type PersonPageInput } from "../src/plugins/people/row-data";
import type { PersonBundle } from "../src/plugins/people/blocks";
import type { KnowledgeOfPerson } from "../src/plugins/people/block-actions";
import type { T } from "../src/lib/i18n/shared";

const t: T = (s, vars) => s.replace(/\{(\w+)\}/g, (_m, k: string) => String(vars?.[k] ?? `{${k}}`));

const ROW: Row = { id: 42, title: "Anna Berg", icon: "", cells: { srcref: "person:1" }, createdAt: "", updatedAt: "" };

const empty = (over: Partial<PersonBundle> = {}): PersonBundle => ({
  id: 1,
  name: "Anna Berg",
  aliases: [],
  emails: [],
  jira: [],
  whatsapp: "",
  note: "",
  starred: false,
  compiled: null,
  dates: [],
  details: [],
  claims: [],
  links: [],
  relations: { out: [], in: [] },
  contacts: [],
  todos: [],
  pages: [],
  tickets: [],
  others: [],
  documents: [],
  cases: [],
  events: null,
  ...over,
});

const full = (over: Partial<PersonBundle> = {}): PersonBundle =>
  empty({
    aliases: ["Anni", "A. Berg"],
    emails: ["anna@example.org"],
    jira: ["aberg"],
    whatsapp: "Anna Berg",
    note: "Likes tea.\nBirthday cake: lemon.",
    starred: true,
    compiled: { connection: "Your sister.", keyFacts: ["Lives in Köln", "Works at X"], funFacts: ["Plays the cello"], at: "2026-10-01", sources: 12 },
    dates: [
      { id: 3, kind: "birthday", label: "Birthday", text: "16.10.1990", confirmed: true, remindDays: 7, sourceText: "", when: "in 359 days", turns: 37 },
      { id: 4, kind: "anniversary", label: "Anniversary", text: "3.5.", confirmed: false, remindDays: 3, sourceText: "“our day is 3 May”", when: "in 193 days", turns: null },
    ],
    details: [
      {
        id: 7,
        key: "iban",
        value: "DE89 3704 0044 0532 0130 00",
        claimId: 0,
        confirmed: true,
        source: "doc:4",
        confirmedAt: "2026-10-20T09:00:00Z",
        history: [{ value: "DE22 6609 0800 0007 7773 02", status: "superseded", source: "mail:m1", at: "2026-10-20" }],
      },
      { id: 8, key: "phone", value: "+49 (221) 123 45", claimId: 9, confirmed: false, source: "mail:m2", confirmedAt: "2026-10-01T09:00:00Z", history: [] },
      { id: 9, key: "address", value: "Ringstraße 1, 50667 Köln", claimId: 0, confirmed: true, source: "you", confirmedAt: "2026-09-01T09:00:00Z", history: [] },
    ],
    claims: [
      { id: 11, kind: "fact", text: "has a dog", status: "proposed", evidence: "my dog Bello", confidence: 0.82, due: "", done: false, source: "" },
      { id: 12, kind: "role", text: "team lead", status: "confirmed", evidence: "I lead the team", confidence: 0.9, due: "", done: false, source: "" },
      { id: 13, kind: "commitment", text: "sends the photos", status: "confirmed", evidence: "", confidence: 0.9, due: "2026-11-01", done: false, source: "" },
      { id: 14, kind: "commitment", text: "returns the book", status: "confirmed", evidence: "", confidence: 0.9, due: "", done: true, source: "" },
    ],
    links: [
      { id: 21, rel: "works-with", targetType: "person", targetRef: "2", label: "", status: "confirmed" },
      { id: 22, rel: "on-ticket", targetType: "ticket", targetRef: "PROJ-1", label: "", status: "confirmed" },
    ],
    relations: { out: [{ id: 31, personId: 1, rel: "sister", otherId: 0, otherName: null, evidence: "said so", source: "manual" }, { id: 32, personId: 1, rel: "mother", otherId: 2, otherName: "Bert Klein", evidence: "", source: "ai" }], in: [{ id: 33, personId: 2, rel: "landlord", otherId: 1, otherName: "Anna Berg", evidence: "", source: "ai", personName: "Clara Dorn" }] },
    contacts: [{ key: "m1", folder: "WhatsApp", who: "Anna", text: "See you Sunday", at: "2026-10-20T10:00:00Z", convId: "c1" }],
    todos: [{ id: 5, ref: "T-5", text: "Call Anna", due: "2026-10-30" }],
    pages: [{ id: 70, title: "Trip planning", icon: "📄" }],
    tickets: ["PROJ-1"],
    others: [{ id: 2, name: "Bert Klein" }, { id: 3, name: "Clara, Dorn: Jr" }],
    documents: [{ id: 80, name: "Lease.pdf", summary: "The lease", at: "2026-09-01T00:00:00Z" }],
    cases: [{ id: 90, label: "AZ 1", title: "Rent", open: 120.5, nextDue: "2026-11-15", done: false, href: "/workspace/91" }],
    events: { upcoming: [{ id: 1, title: "Lunch", start: "2026-10-25T12:00", end: "2026-10-25T13:00", allDay: false, location: "Café", calendar: "Home", color: "#22c55e", href: "/calendar?day=2026-10-25" }], recent: [] },
    ...over,
  });

const WIKI: KnowledgeOfPerson = { summary: "Anna is a designer.", related: [{ name: "Bert", rels: ["works with"] }], pages: [{ id: "p1", title: "Design", space: "Team", href: "https://wiki.example/p1" }], graph: "https://graph.example/anna", error: null, merge: { id: 5, names: ["Anna", "Anna Berg"] } };

const input = (over: Partial<PersonPageInput> = {}): PersonPageInput => ({ person: full(), error: null, loading: false, wiki: WIKI, ...over });

const find = (nodes: VNode[], tag: string): Extract<VNode, object>[] => nodes.flatMap((n) => (typeof n === "string" ? [] : [...(n.t === tag ? [n] : []), ...find(n.c, tag)]));
const parts = (nodes: VNode[], name: string) => find(nodes, "part").filter((p) => p.a.name === name);
const buttons = (nodes: VNode[], action: string) => find(nodes, "button").filter((b) => b.a.action === action);
const draw = (x: PersonPageInput, state: Record<string, string> = {}) =>
  renderView(PERSON_PAGE.defaultTemplate(t), { rows: [ROW], props: [], titleName: "Name", state, app: personPageData(x, { t, locale: "en-GB" }), db: { id: 1, title: "People" }, locale: "en-GB", current: ROW }, { parts: PERSON_PAGE.parts, actions: PERSON_PAGE.actions });

test("a person's page draws without an error — loading, not a person, an empty person, a full one, every tab, the knowledge in each state", () => {
  const cases: [PersonPageInput, Record<string, string>][] = [
    [input({ person: null, loading: true, wiki: undefined }), {}],
    [input({ person: null, error: "This row is not a person." }), {}],
    [input({ person: empty(), wiki: null }), {}],
    [input({ person: empty(), wiki: undefined }), {}],
    [input(), {}],
    [input(), { known: "check" }],
    [input(), { known: "facts" }],
    [input(), { known: "done" }],
    [input(), { busy: "compile", saved: "profile" }],
    [input(), { busy: "findDates", saved: "note", keep: "2" }],
    [input({ wiki: { ...WIKI, error: "The knowledge server did not answer in time." } }), {}],
    [input({ wiki: { summary: "", related: [], pages: [], graph: null, error: null } }), {}],
    [input({ person: full({ claims: [], links: [{ id: 21, rel: "works-with", targetType: "person", targetRef: "9", label: "", status: "" }] }) }), {}],
  ];
  for (const [x, state] of cases) assert.deepEqual(draw(x, state).errors, [], JSON.stringify({ state, loading: x.loading, person: !!x.person }));
});

test("loading shows …, a row that is no person says so", () => {
  assert.equal(vnodeToString(draw(input({ person: null, loading: true })).nodes).trim().includes("…"), true);
  assert.equal(parts(draw(input({ person: null, loading: true })).nodes, "person.input").length, 0);
  assert.match(vnodeToString(draw(input({ person: null, error: "This row is not a person." })).nodes), /This row is not a person\./);
});

test("the profile: an input per field (saved on leaving it), the star, “Saved ✓” for a moment", () => {
  const r = draw(input(), { saved: "profile" });
  assert.deepEqual(parts(r.nodes, "person.input").map((p) => p.a.field), ["name", "aliases", "emails", "whatsapp", "jira"]);
  const star = buttons(r.nodes, "person.star");
  assert.equal(star.length, 1);
  assert.equal(star[0].a.label, "★");
  assert.equal(star[0].a.tip, "Remove star");
  assert.match(vnodeToString(r.nodes), /Saved ✓/);
  assert.equal(buttons(draw(input({ person: empty() })).nodes, "person.star")[0].a.label, "☆");
  assert.doesNotMatch(vnodeToString(draw(input()).nodes), /Saved ✓/);
});

test("details: each with its label, copy and remove; a phone to call, an address on the map; the transfer when there is an IBAN; the form to add one", () => {
  const r = draw(input());
  const s = vnodeToString(r.nodes);
  assert.match(s, /IBAN/);
  assert.deepEqual(buttons(r.nodes, "person.copy").map((b) => b.a.value), ["DE89 3704 0044 0532 0130 00", "+49 (221) 123 45", "Ringstraße 1, 50667 Köln"]);
  assert.deepEqual(buttons(r.nodes, "person.removeDetail").map((b) => b.a.value), ["7", "8", "9"]);
  assert.ok(find(r.nodes, "a").some((l) => l.a.href === "tel:+4922112345"), "a phone to call — a tel: link");
  assert.ok(find(r.nodes, "a").some((a) => a.a.href === "https://www.openstreetmap.org/search?query=Ringstra%C3%9Fe%201%2C%2050667%20K%C3%B6ln"));
  assert.match(s, /unchecked/);
  // Where each was read and when it was last confirmed; what it was before on hover.
  assert.match(s, /doc:4 · confirmed 2026-10-20/);
  assert.match(s, /you · confirmed 2026-09-01/);
  assert.ok(find(r.nodes, "text").some((x) => /DE22 6609 0800 0007 7773 02 — superseded 2026-10-20 \(mail:m1\)/.test(String(x.a.tip ?? ""))), "the history as the tip");
  assert.equal(parts(r.nodes, "person.transfer").length, 1);
  assert.equal(parts(r.nodes, "person.addDetail").length, 1);
  const none = draw(input({ person: empty() }));
  assert.equal(parts(none.nodes, "person.transfer").length, 0, "no IBAN, no transfer");
  assert.equal(parts(none.nodes, "person.addDetail").length, 1);
  assert.match(vnodeToString(none.nodes), /No bank account, address or phone known yet/);
});

test("notes, the summary (compile, again), the dates (right, wrong, remind, find, add)", () => {
  const r = draw(input());
  const s = vnodeToString(r.nodes);
  assert.equal(parts(r.nodes, "person.note").length, 1);
  for (const x of ["What connects you", "Your sister.", "Key facts", "Lives in Köln", "Fun facts", "🎈 Plays the cello", "Compiled from 12 things"]) assert.ok(s.includes(x), x);
  assert.equal(buttons(r.nodes, "person.compile")[0].a.label, "Compile again");
  assert.equal(buttons(draw(input(), { busy: "compile" }).nodes, "person.compile")[0].a.label, "…");
  assert.equal(buttons(draw(input(), { busy: "compile" }).nodes, "person.compile")[0].a.disabled, "true");
  const fresh = draw(input({ person: empty() }));
  assert.equal(buttons(fresh.nodes, "person.compile")[0].a.label, "Compile");
  assert.match(vnodeToString(fresh.nodes), /Not compiled yet/);
  // Dates: the found one to confirm, the confirmed one with its reminder.
  assert.match(s, /turns 37/);
  assert.match(s, /found — is it right\?/);
  assert.deepEqual(buttons(r.nodes, "person.dateRight").map((b) => b.a.value), ["4"]);
  assert.deepEqual(buttons(r.nodes, "person.dateWrong").map((b) => `${b.a.value}:${b.a.label}`), ["3:Delete", "4:Wrong"]);
  assert.deepEqual(parts(r.nodes, "person.remind").map((p) => `${p.a.date}:${p.a.days}`), ["3:7"]);
  assert.equal(buttons(r.nodes, "person.findDates").length, 1);
  assert.equal(parts(r.nodes, "person.addDate").length, 1);
  assert.match(vnodeToString(fresh.nodes), /No date yet/);
});

test("read from your messages: three tabs with their counts, to check first when there is something", () => {
  const r = draw(input());
  const tabs = find(r.nodes, "tabs").find((x) => x.a.bind === "known")!;
  assert.deepEqual(JSON.parse(tabs.a.options), [["check", "To check", "1"], ["facts", "Facts", "2"], ["done", "Done", "1"]]);
  assert.equal(tabs.a.current, "check");
  assert.deepEqual(buttons(r.nodes, "person.right").map((b) => b.a.value), ["11"]);
  assert.deepEqual(buttons(r.nodes, "person.wrong").map((b) => b.a.value), ["11"]);
  assert.match(vnodeToString(r.nodes), /“my dog Bello” · 82%/);
  // Nothing to check: the facts first.
  const facts = draw(input({ person: full({ claims: full().claims.filter((c) => c.id !== 11) }) }));
  assert.equal(find(facts.nodes, "tabs").find((x) => x.a.bind === "known")!.a.current, "facts");
  const f = draw(input(), { known: "facts" });
  const fs = vnodeToString(f.nodes);
  assert.ok(fs.indexOf("Role") < fs.indexOf("team lead") && fs.indexOf("Commitments") < fs.indexOf("sends the photos"), "grouped by kind");
  assert.match(fs, /2026-11-01/);
  assert.deepEqual(buttons(f.nodes, "person.done").map((b) => b.a.value), ["13"]);
  assert.equal(buttons(f.nodes, "person.right").length, 0);
  const d = vnodeToString(draw(input(), { known: "done" }).nodes);
  assert.match(d, /returns the book/);
  assert.doesNotMatch(d, /has a dog/);
  // The links as chips: the relation, whom.
  assert.match(vnodeToString(r.nodes), /works with/);
  assert.match(vnodeToString(r.nodes), /Bert Klein/);
  const none = draw(input({ person: empty() }));
  assert.equal(find(none.nodes, "tabs").filter((x) => x.a.bind === "known").length, 0);
  assert.match(vnodeToString(none.nodes), /Nothing read from your messages yet/);
});

test("relations (remove, the form to add one), same person or gone (merge, delete)", () => {
  const r = draw(input());
  const s = vnodeToString(r.nodes);
  assert.match(s, /sister/);
  assert.match(s, /\(to you\)/);
  assert.match(s, /of Bert Klein/);
  assert.match(s, /Clara Dorn: /);
  assert.deepEqual(buttons(r.nodes, "person.removeRelation").map((b) => b.a.value), ["31", "32", "33"]);
  assert.equal(parts(r.nodes, "person.addRelation").length, 1);
  const keep = find(r.nodes, "select").find((x) => x.a.bind === "keep")!;
  assert.deepEqual(JSON.parse(keep.a.options), [["", "Pick a profile …"], ["2", "Bert Klein"], ["3", "Clara Dorn Jr"]]);
  assert.equal(buttons(r.nodes, "person.merge")[0].a.disabled, "true");
  const picked = buttons(draw(input(), { keep: "2" }).nodes, "person.merge")[0];
  assert.equal(picked.a.disabled, "false");
  assert.equal(picked.a.value, "2");
  const del = buttons(r.nodes, "person.delete")[0];
  assert.equal(del.a.confirm, "Delete the profile of “Anna Berg”?");
  assert.equal(find(draw(input({ person: empty() })).nodes, "select").filter((x) => x.a.bind === "keep").length, 0, "no one else: nothing to merge into");
  assert.match(vnodeToString(draw(input({ person: empty() })).nodes), /None known yet/);
});

test("what the knowledge knows: loading, an error, nobody, the summary with the merge, the related and the pages — none without the plugin", () => {
  const r = draw(input());
  const s = vnodeToString(r.nodes);
  assert.match(s, /What the knowledge knows/);
  assert.match(s, /Anna is a designer\./);
  assert.match(s, /The knowledge keeps them as 2 entries: Anna, Anna Berg\./);
  assert.deepEqual(buttons(r.nodes, "person.knowledgeMerge").map((b) => b.a.value), ["5"]);
  assert.deepEqual(buttons(r.nodes, "person.knowledgeDismiss").map((b) => b.a.value), ["5"]);
  assert.ok(find(r.nodes, "a").some((a) => a.a.href === "https://graph.example/anna"));
  assert.ok(find(r.nodes, "section").some((x) => x.a.title === "1 pages" && x.a.collapsible === "true"));
  assert.doesNotMatch(vnodeToString(draw(input({ wiki: null })).nodes), /What the knowledge knows/);
  assert.match(vnodeToString(draw(input({ wiki: { ...WIKI, error: "down" } })).nodes), /down/);
  assert.match(vnodeToString(draw(input({ wiki: { summary: "", related: [], pages: [], graph: null, error: null } })).nodes), /The knowledge knows nobody of this name/);
});

test("over the full width: messages, todos, appointments, cases, letters, pages, tickets — each leads where it did", () => {
  const r = draw(input());
  const s = vnodeToString(r.nodes);
  for (const x of ["Latest messages", "See you Sunday", "Todos they appear in", "Call Anna", "Appointments", "Coming up", "Lunch", "Café", "Nothing in the last 30 days.", "Cases", "Rent", "€120.50", "Letters and documents", "The lease", "Mentioned in your workspace", "Shared tickets", "🎫 PROJ-1"]) assert.ok(s.includes(x), x);
  const urls = buttons(r.nodes, "url").map((b) => b.a.href);
  for (const x of ["/t/5", "/calendar?day=2026-10-25", "/workspace/91", "/workspace/70"]) assert.ok(urls.includes(x), x);
  assert.ok(find(r.nodes, "a").some((a) => a.a.href === "/api/documents/80/file"));
  const e = vnodeToString(draw(input({ person: empty() })).nodes);
  for (const x of ["No messages", "No open todo names them.", "No page mentions them yet", "No ticket known yet"]) assert.ok(e.includes(x), x);
  for (const x of ["Appointments", "Letters and documents", "Cases"]) assert.ok(!e.includes(x), `${x}: not without them`);
  const noneSoon = vnodeToString(draw(input({ person: full({ events: { upcoming: [], recent: [] } }) })).nodes);
  assert.match(noneSoon, /No appointment with them in the last or next 30 days/);
});

test("the page's parts and actions are the ones the meta names", () => {
  const names = PERSON_PAGE.parts.map((p) => p.name).sort();
  assert.deepEqual(names, ["person.addDate", "person.addDetail", "person.addRelation", "person.input", "person.note", "person.remind", "person.transfer"]);
  const acts = PERSON_PAGE.actions.map((a) => a.name);
  for (const a of ["person.star", "person.compile", "person.findDates", "person.right", "person.wrong", "person.done", "person.dateRight", "person.dateWrong", "person.copy", "person.call", "person.removeDetail", "person.removeRelation", "person.merge", "person.delete", "person.knowledgeMerge", "person.knowledgeDismiss"]) assert.ok(acts.includes(a), a);
  assert.ok(PERSON_PAGE.appData.includes("app.known"));
});
