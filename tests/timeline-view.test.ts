import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const ev = (id: number, at: string, kind: string, title: string, extra: Record<string, unknown> = {}) => ({ id, at, kind, source: "mail", sourceRef: String(id), title, summary: "", actorRef: "", url: "", data: {}, refs: [], entities: [], ...extra });

test("byDay groups by the local day in the order given; seenIndex puts the marker before the first event already seen", async () => {
  const { byDay, seenIndex, kindIcon, localDay } = await import("@/plugins/timeline/shared");
  const events = [ev(3, "2026-10-21T15:00:00.000Z", "mail", "c"), ev(2, "2026-10-21T09:00:00.000Z", "todo.done", "b"), ev(1, "2026-10-19T09:00:00.000Z", "row.changed", "a")];
  const days = byDay(events);
  assert.deepEqual(days.map((d) => d.day), [localDay(events[0].at), localDay(events[2].at)]);
  assert.equal(days[0].events.length, 2);
  assert.equal(seenIndex(events, "2026-10-21T10:00:00.000Z"), 1, "one new above the line");
  assert.equal(seenIndex(events, null), -1, "never looked: no line");
  assert.equal(seenIndex(events, "2026-10-22T00:00:00.000Z"), -1, "nothing new: no line");
  assert.equal(seenIndex(events, "2026-01-01T00:00:00.000Z"), -1, "all new: no line");
  assert.equal(kindIcon("todo.done"), "☑️");
  assert.equal(kindIcon("todo.something"), kindIcon("todo"), "a kind without a sign of its own: its group's");
});

test("the timeline renders: days, a sign and a name per kind, links to the source and the entities, the new-since line", async () => {
  const { TimelineView } = await import("@/plugins/timeline/ui/TimelineView");
  const events = [
    ev(3, "2026-10-21T15:00:00.000Z", "mail", "Angebot Relaunch", { url: "/mail?q=Angebot", summary: "Hier das Angebot", entities: [{ ref: "ticket:ORD-12", label: "ORD-12 Navigation", href: "/tickets?ticket=ORD-12" }] }),
    ev(2, "2026-10-21T09:00:00.000Z", "todo.done", "Rico erinnern", { url: "https://example.com/x" }),
    ev(1, "2026-10-19T09:00:00.000Z", "row.changed", "Tag am See"),
  ];
  const html = renderToStaticMarkup(createElement(TimelineView, { events, lastSeen: "2026-10-21T10:00:00.000Z" }));
  assert.match(html, /Angebot Relaunch/);
  assert.match(html, /href="\/mail\?q=Angebot"/);
  assert.match(html, /href="https:\/\/example.com\/x"[^>]*target="_blank"/);
  assert.match(html, /ORD-12 Navigation/);
  assert.match(html, /Todo done/);
  assert.match(html, /☑️/);
  assert.match(html, /New since your last visit/);
  assert.equal((html.match(/data-day=/g) ?? []).length, 2, "two days");
  assert.ok(html.indexOf("New since your last visit") > html.indexOf("Angebot Relaunch") && html.indexOf("New since your last visit") < html.indexOf("Rico erinnern"));
  assert.match(renderToStaticMarkup(createElement(TimelineView, { events: [], lastSeen: null })), /Nothing yet/);
});

test("the timeline block in a page's Markdown: :::block timeline, both ways, its limit held in bounds", async () => {
  const { markdownToDoc, docToMarkdown, sanitizeDoc } = await import("@/plugins/workspace/doc");
  const doc = markdownToDoc(':::block timeline {"ref":"person:3","limit":15}\n\n:::block timeline\n');
  assert.deepEqual(doc.content.map((n) => n.type), ["zeffTimeline", "zeffTimeline"]);
  assert.deepEqual(doc.content[0].attrs, { ref: "person:3", limit: 15 });
  const out = docToMarkdown(doc);
  assert.match(out, /:::block timeline \{"ref":"person:3","limit":15\}/);
  assert.equal(docToMarkdown(markdownToDoc(out)), out);
  const clean = sanitizeDoc({ type: "doc", content: [{ type: "zeffTimeline", attrs: { ref: "x".repeat(500), limit: 9999 } }] });
  assert.equal(clean.content[0].attrs!.limit, 100);
  assert.equal(String(clean.content[0].attrs!.ref).length, 200);
});
