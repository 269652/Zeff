import assert from "node:assert/strict";
import test from "node:test";
import { vnodeToString, type VNode } from "../src/plugins/workspace/card-template";
import { renderView } from "../src/plugins/workspace/view-template";
import type { Row } from "../src/plugins/workspace/model";
import { CASE_PAGE } from "../src/plugins/cases/row-template.meta";
import { caseAppData } from "../src/plugins/cases/view-data";
import type { CaseBundle } from "../src/plugins/cases/blocks";
import type { CaseSummary } from "../src/plugins/cases/shared";
import type { T } from "../src/lib/i18n/shared";

const t: T = (s, vars) => s.replace(/\{(\w+)\}/g, (_m, k: string) => String(vars?.[k] ?? `{${k}}`));

const row: Row = { id: 42, title: "Rundfunkbeitrag", icon: "", cells: {}, createdAt: "2026-10-01", updatedAt: "2026-10-20" };
const summary: CaseSummary = {
  title: "Rundfunkbeitrag", party: "Beitragsservice", summary: "Vollstreckung wegen offener Beiträge; Ratenzahlung vereinbart.", total: 1200, open: 800, installment: 100,
  nextDue: "2026-11-15", nextWhat: "Rate", iban: "DE02120300000000202051", bic: "BYLADEM1001", payee: "OGV", purpose: "DR II 1121/26", done: false, at: "2026-10-20", sources: 3,
};
const bundle = (over: Partial<CaseBundle> = {}): CaseBundle => ({
  id: 7, key: "DR II 1121/26", label: "11 DR II 1121/26", title: "Rundfunkbeitrag", status: "open", note: "", compiled: null, person: null, people: [], parties: {}, manual: false,
  sources: [], todos: [], counts: { mail: 0, doc: 0, todo: 0 }, canCompile: true, payment: null, compiling: false, paid: [], openNow: null, ...over,
});
const sources = [{ source: "mail", id: 1 }, { source: "document", id: 2 }] as unknown as CaseBundle["sources"];
const SUMMED = bundle({
  compiled: summary,
  person: { id: 3, name: "Beitragsservice", href: "/workspace/300" },
  parties: { creditor: { personId: 3, name: "Beitragsservice", href: "/workspace/300", source: "ai" }, collector: { personId: 4, name: "Ulrike Nathanael", href: "/workspace/400", source: "manual" } },
  todos: [{ id: 5, ref: "T-5", text: "Rate überweisen", done: false, due: "2026-11-15" }, { id: 6, ref: "T-6", text: "Antrag stellen", done: true, due: null }],
  counts: { mail: 2, doc: 1, todo: 2 },
  sources,
  payment: { name: "OGV", iban: "DE02120300000000202051", bic: "BYLADEM1001", purpose: "DR II 1121/26", amount: 100 },
  paid: [{ date: "2026-09-15", amount: 100 }, { date: "2026-10-15", amount: 100 }],
  openNow: 700,
});

const find = (nodes: VNode[], tag: string): Extract<VNode, object>[] => nodes.flatMap((n) => (typeof n === "string" ? [] : [...(n.t === tag ? [n] : []), ...find(n.c, tag)]));
const text = (nodes: VNode[]) => vnodeToString({ t: "x", a: {}, c: nodes });
const draw = (app: Record<string, unknown>) =>
  renderView(CASE_PAGE.defaultTemplate(t), { rows: [row], props: [], titleName: "Name", state: {}, app, db: { id: 1, title: "Vorgänge" }, locale: "de-DE", current: row }, { parts: CASE_PAGE.parts, actions: CASE_PAGE.actions });
const data = (b: CaseBundle, busy = false) => caseAppData(b, { t, busy, locale: "de-DE" });

test("the case page's default template draws without an error — loading, not summed up, summed with payment, without account, no sources, own debt", () => {
  assert.deepEqual(draw({ loading: true, error: null }).errors, []);
  assert.deepEqual(draw(data(bundle())).errors, []);
  assert.deepEqual(draw(data(bundle({ compiling: true }))).errors, []);
  assert.deepEqual(draw(data(SUMMED)).errors, []);
  assert.deepEqual(draw(data(SUMMED, true)).errors, []);
  assert.deepEqual(draw(data({ ...SUMMED, payment: null })).errors, []);
  assert.deepEqual(draw(data({ ...SUMMED, sources: [], counts: { mail: 0, doc: 0, todo: 2 } })).errors, []);
  assert.deepEqual(draw(data(bundle({ compiled: { ...summary, manual: true }, manual: true, canCompile: false }))).errors, []);
});

test("while loading: the error or …, nothing else", () => {
  assert.match(text(draw({ loading: true, error: null }).nodes), /…/);
  const r = draw({ loading: true, error: "This row is not a case." });
  assert.match(text(r.nodes), /This row is not a case\./);
  assert.equal(find(r.nodes, "part").length, 0);
  assert.equal(find(r.nodes, "section").length, 0);
});

test("summed up, with an account: the header, four figures, todos, sources, payment, paid, parties, notes", () => {
  const r = draw(data(SUMMED));
  const all = text(r.nodes);
  // The header: the case number, its creditor (to its page), who collects it, the status, Sum up again.
  assert.equal(find(r.nodes, "code")[0].c[0], "11 DR II 1121/26");
  const urls = find(r.nodes, "button").filter((b) => b.a.action === "url");
  assert.deepEqual(urls.slice(0, 2).map((b) => [b.a.label, b.a.href]), [["Beitragsservice", "/workspace/300"], ["Ulrike Nathanael", "/workspace/400"]]);
  assert.match(all, /via/);
  const sum = find(r.nodes, "button").find((b) => b.a.action === "case.compile");
  assert.equal(sum?.a.label, "Sum up again");
  assert.notEqual(sum?.a.disabled, "true");
  assert.equal(sum?.a.row, "42", "acts on the page's row");
  const parts = find(r.nodes, "part").map((p) => p.a.name);
  assert.deepEqual(parts, ["case.status", "case.sources", "case.timeline", "case.pay", "case.contact", "case.contact", "case.contact", "case.note"]);
  assert.deepEqual(find(r.nodes, "part").filter((p) => p.a.name === "case.contact").map((p) => p.a.role), ["creditor", "collector", "payee"]);
  // The layout: the main column and the payment beside it.
  const split = find(r.nodes, "split")[0];
  assert.equal(split.a.side, "right");
  assert.deepEqual(find(r.nodes, "section").map((s) => s.a.title), ["Where it stands", "Todos", "Mails and letters", "Payment", "Paid (bank)", "Parties", "Notes"]);
  // Where it stands: the summary and the money.
  assert.match(all, /Ratenzahlung vereinbart/);
  const tiles = find(r.nodes, "tile");
  assert.deepEqual(tiles.map((x) => x.a.label), ["Total", "Open", "Instalment", "Next"]);
  assert.deepEqual(tiles.map((x) => x.a.value), ["1.200,00 €", "700,00 €", "100,00 €", "15.11.2026 · Rate"]);
  // The todos: their refs to their pages, the done one marked.
  const todos = find(r.nodes, "list")[0];
  assert.equal(todos.c.length, 2);
  assert.deepEqual(urls.filter((b) => b.a.href.startsWith("/t/")).map((b) => [b.a.label, b.a.href]), [["T-5", "/t/5"], ["T-6", "/t/6"]]);
  assert.match(text(todos.c.slice(0, 1)), /Rate überweisen.*15\.11\.2026/);
  assert.match(vnodeToString(todos.c.slice(1) as never), /<strike>Antrag stellen<\/strike>/, "a done one crossed out");
  assert.match(all, /2 mails · 1 letters/);
  // Paid: newest first.
  const paid = find(r.nodes, "list")[1];
  assert.match(text(paid.c.slice(0, 1)), /15\.10\.2026.*100,00 €/);
  // The parties: the creditor and the collector to their pages, as the AI read it or chosen by you.
  const partyLinks = urls.filter((b) => b.a.label.endsWith("→"));
  assert.deepEqual(partyLinks.map((b) => [b.a.label, b.a.tip]), [["Beitragsservice →", "As the AI read it from the case"], ["Ulrike Nathanael →", "Chosen by you"]]);
  assert.match(all, /Creditor.*Collected by.*Paid to/);
});

test("busy: the button says … and can't be pressed", () => {
  const sum = find(draw(data(SUMMED, true)).nodes, "button").find((b) => b.a.action === "case.compile");
  assert.equal(sum?.a.label, "…");
  assert.equal(sum?.a.disabled, "true");
});

test("not summed up yet: Sum up, the text that says so, no figures, no todos, no sources, no account", () => {
  const r = draw(data(bundle()));
  const all = text(r.nodes);
  assert.equal(find(r.nodes, "button").find((b) => b.a.action === "case.compile")?.a.label, "Sum up");
  assert.match(all, /Not summed up yet — Sum up reads its mails, letters and todos\./);
  assert.equal(find(r.nodes, "tile").length, 0);
  assert.match(all, /No todo names this case\./);
  assert.match(all, /No mail or letter found for it yet\./);
  assert.match(all, /No account known for it yet — choose the person it is with\./);
  assert.equal(find(r.nodes, "section").some((s) => s.a.title === "Paid (bank)"), false);
  assert.deepEqual(find(r.nodes, "part").map((p) => p.a.name), ["case.status", "case.timeline", "case.contact", "case.contact", "case.contact", "case.note"]);
  assert.match(text(draw(data(bundle({ compiling: true }))).nodes), /Being summed up from its mails, letters and todos …/);
  assert.match(text(draw(data(bundle({ canCompile: false }))).nodes), /With the LLM plugin the AI sums the case up\./);
  assert.equal(find(draw(data(bundle({ canCompile: false }))).nodes, "button").some((b) => b.a.action === "case.compile"), false);
});

test("summed, without an account: the person's name in the hint; no creditor: the person and the party", () => {
  const b = { ...SUMMED, payment: null, parties: {} };
  const r = draw(data(b));
  const all = text(r.nodes);
  assert.match(all, /No account known for Beitragsservice yet — add the IBAN to their details\./);
  assert.equal(find(r.nodes, "part").some((p) => p.a.name === "case.pay"), false);
  const person = find(r.nodes, "button").find((x) => x.a.action === "url");
  assert.deepEqual([person?.a.label, person?.a.href], ["Beitragsservice", "/workspace/300"]);
  assert.match(all, /Beitragsservice/);
  assert.equal(find(r.nodes, "button").some((x) => x.a.label?.endsWith("→")), false);
});

test("an own debt: its chip, no case number, no Sum up, no figures", () => {
  const r = draw(data(bundle({ compiled: { ...summary, manual: true }, manual: true })));
  assert.match(text(r.nodes), /Own debt/);
  assert.equal(find(r.nodes, "code").length, 0);
  assert.equal(find(r.nodes, "button").some((b) => b.a.action === "case.compile"), false);
  assert.equal(find(r.nodes, "tile").length, 0);
});

test("in German and Spanish too: the bundles' texts (quotes, apostrophes) draw without an error", async () => {
  for (const lang of ["de", "es"]) {
    const texts = (await import(`../src/plugins/lang-${lang}/bundle.json`, { with: { type: "json" } })).default as Record<string, string>;
    const tl: T = (s, vars) => (texts[s] ?? s).replace(/\{(\w+)\}/g, (_m, k: string) => String(vars?.[k] ?? `{${k}}`));
    for (const b of [SUMMED, bundle()]) {
      const r = renderView(CASE_PAGE.defaultTemplate(tl), { rows: [row], props: [], titleName: "Name", state: {}, app: caseAppData(b, { t: tl, busy: false, locale: "de-DE" }), db: { id: 1, title: "Vorgänge" }, locale: "de-DE", current: row }, { parts: CASE_PAGE.parts, actions: CASE_PAGE.actions });
      assert.deepEqual(r.errors, [], lang);
      assert.equal(find(r.nodes, "section").length > 4, true);
    }
  }
});
