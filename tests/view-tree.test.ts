import assert from "node:assert/strict";
import test from "node:test";

/**
 * The visual builder's tree: a template read into it and written back draws the same view (the Agenda's, the mail's, the inbox's,
 * the kit's elements); elements put in, moved and removed by their place.
 */

const t = (s: string, v?: Record<string, unknown>) => (v ? s.replace(/\{(\w+)\}/g, (_, k) => String(v[k])) : s);

test("a template written back from its tree draws the same view", async () => {
  const { renderView } = await import("@/plugins/workspace/view-template");
  const { templateToTree, treeToTemplate, KIT } = await import("@/plugins/workspace/view-tree");
  const { agendaScreen, agendaNames } = await import("@/plugins/agenda/view-template.meta");
  const { MAIL_VIEW, INBOX_VIEW, CHAT_VIEW } = await import("@/plugins/mail-client/view-template.meta");
  const { TEMPLATE_VIEW } = await import("@/plugins/workspace/view-apps");
  const templates = [agendaScreen({ ...agendaNames(t), event: "Event" }, t), MAIL_VIEW.defaultTemplate(t), INBOX_VIEW.defaultTemplate(t), CHAT_VIEW.defaultTemplate(t), TEMPLATE_VIEW.defaultTemplate(t), ...KIT.map((k) => k.template)];
  const data = { rows: [], props: [], titleName: "Name", state: { q: "x", scope: "all" }, app: {}, db: { id: 1, title: "X" } };
  for (const src of templates) {
    const tree = templateToTree(src);
    assert.deepEqual(tree.errors, [], src.slice(0, 80));
    const back = treeToTemplate(tree.nodes);
    const a = renderView(src, data);
    const b = renderView(back, data);
    assert.deepEqual(b.errors.map((e) => e.message), a.errors.map((e) => e.message), back.slice(0, 200));
    assert.deepEqual(JSON.stringify(b.nodes), JSON.stringify(a.nodes), `${src.slice(0, 60)}\n---\n${back.slice(0, 400)}`);
    assert.equal(treeToTemplate(templateToTree(back).nodes), back, "stable: written twice, the same");
  }
});

test("elements put in, moved into a container, removed — by their place", async () => {
  const { templateToTree, treeToTemplate, insertAt, moveTo, removeAt, kitNodes, KIT, nodeAt, slotOfPath } = await import("@/plugins/workspace/view-tree");
  let nodes = templateToTree('<toolbar><search bind="q"/></toolbar>{{#if state.q}}<b>yes</b>{{#else}}<b>no</b>{{/if}}').nodes;
  nodes = insertAt(nodes, { parent: null, branch: "kids" }, 0, kitNodes(KIT.find((k) => k.id === "heading")!)[0]);
  assert.match(treeToTemplate(nodes), /^<heading level="2">Title<\/heading>/);
  // The heading into the toolbar, after the search.
  nodes = moveTo(nodes, [0], { parent: [1], branch: "kids" }, 1);
  assert.match(treeToTemplate(nodes), /<toolbar>[\s\S]*<search bind="q"\/>[\s\S]*<heading level="2">Title<\/heading>[\s\S]*<\/toolbar>/);
  // The else's <b> is reached by its own place.
  const elsePath = [1, 1000];
  assert.equal((nodeAt(nodes, elsePath) as { name: string }).name, "b");
  assert.deepEqual(slotOfPath(nodes, elsePath), { slot: { parent: [1], branch: "else" }, index: 0 });
  nodes = removeAt(nodes, elsePath).nodes;
  assert.doesNotMatch(treeToTemplate(nodes), /no/);
  assert.equal(moveTo(nodes, [0], { parent: [0], branch: "kids" }, 0), nodes, "not into itself");
});
