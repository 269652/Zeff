import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

test("Agenda: a page with projects and notes; its screen draws, and its scopes pick the right notes", async () => {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("agenda", true);
  const { agendaPage } = await import("@/plugins/agenda/template");
  const { getPage, rowsOf, children } = (await import("@/plugins/workspace/store")) as typeof import("@/plugins/workspace/store") & { children?: never };
  void children;
  const { renderView } = await import("@/plugins/workspace/view-template");
  const { AGENDA_VIEW } = await import("@/plugins/agenda/view-template.meta");
  const { getSqlite } = await import("@/db");
  const root = agendaPage(null);
  const dbs = getSqlite().prepare("select id, title from ws_pages where parent_id = ? and kind = 'database' order by id").all(root) as { id: number; title: string }[];
  assert.equal(dbs.length, 2);
  const notes = rowsOf(dbs[1].id)!;
  assert.equal(notes.rows.length, 3);
  const view = notes.schema.views[0];
  assert.equal(view.app, "agenda");
  assert.equal(notes.schema.dataType, "agenda");
  const draw = (state: Record<string, string>) => renderView(view.template!, { rows: notes.rows, props: notes.schema.properties, titleName: notes.schema.titleName, state, app: {}, db: { id: dbs[1].id, title: "Notes" } }, { parts: AGENDA_VIEW.parts });
  const all = draw({});
  assert.deepEqual(all.errors, []);
  const timeline = (r: ReturnType<typeof draw>) => {
    const find = (l: unknown[]): { c: unknown[] } | null => {
      for (const n of l as ({ t: string; c: unknown[] } | string)[]) {
        if (typeof n === "string") continue;
        if (n.t === "timeline") return n;
        const inner = find(n.c);
        if (inner) return inner;
      }
      return null;
    };
    return find(r.nodes)!.c.filter((x) => typeof x !== "string").length;
  };
  assert.equal(timeline(all), 3, "all open notes");
  assert.equal(timeline(draw({ scope: "agenda" })), 2, "on the agenda");
  assert.equal(timeline(draw({ scope: "today" })), 1, "today");
  assert.equal(timeline(draw({ scope: "done" })), 0);
  // A project whose notes are all done isn't offered — only under Done.
  const { addRow } = await import("@/plugins/workspace/store");
  const props = notes.schema.properties;
  const pid = (name: string) => props.find((x) => x.name === name)!.id;
  const old = addRow(dbs[0].id, { title: "Old project" });
  const project = props.find((x) => x.type === "relation")!;
  addRow(dbs[1].id, { title: "Finished", cells: { [project.id]: [old], [pid("Done")]: true } });
  const again = rowsOf(dbs[1].id)!;
  const labels = { person: () => "", page: (id: number) => (id === old ? "Old project" : "Getting started"), todo: () => "" };
  const facets = (state: Record<string, string>) => {
    const r = renderView(view.template!, { rows: again.rows, props: again.schema.properties, titleName: again.schema.titleName, state, app: {}, db: { id: dbs[1].id, title: "Notes" }, labels }, { parts: AGENDA_VIEW.parts });
    const find = (l: unknown[]): { a: Record<string, string> } | null => {
      for (const n of l as ({ t: string; a: Record<string, string>; c: unknown[] } | string)[]) {
        if (typeof n === "string") continue;
        if (n.t === "facets") return n;
        const inner = find(n.c);
        if (inner) return inner;
      }
      return null;
    };
    return (JSON.parse(find(r.nodes)!.a.options) as [string][]).map((o) => o[0]);
  };
  assert.deepEqual(facets({}), ["Getting started"]);
  assert.deepEqual(facets({ scope: "done" }), ["Old project"]);
  assert.ok(getPage(root));
});
