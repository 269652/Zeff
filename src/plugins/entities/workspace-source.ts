import type { WorkspaceSource } from "@/plugins/workspace/source-point";
import type { Row } from "@/plugins/workspace/model";
import type { SourceRecord } from "@/plugins/workspace/pipeline";
import { t } from "@/lib/i18n/server";
import { createProject } from "@/lib/projects";
import { detailText, entityDetail } from "./detail";
import { createEntity, deleteEntity, listEntities, parseRef, updateEntity, type EntityKind } from "./store";
import { deriveEntityLinks, findEntitySuggestions } from "./suggest";

/**
 * Organisations, projects and places as sources of the Workspace's pipelines — a record per entity, its page what Zeff gathered
 * about it (people, projects, tickets, mails, money; appointments; job, keys, repos, hours). The entities stay in the plugin's
 * tables (and the time tracking's projects); the rows are a two-way view like People's: an edit in the database goes to the
 * entity, one that changed since the row was read wins, a row of your own makes one. Reading looks for new proposals first (the
 * review queue) and links people to what you confirmed.
 */

/** Fixed field ids: what the databases' views rely on. */
const F = { aliases: "entaliases", domains: "entdomains", address: "entaddress", people: "entpeople", projects: "entprojects", job: "entjob", jira: "entjira", repos: "entrepos", dbs: "entdbs", org: "entorg", hours: "enthours", note: "entnote" };
const list = (v: unknown) => [...new Set(String(v ?? "").split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean))];
const clip = (items: string[], n = 8) => items.slice(0, n).join(" · ");

function refresh(): void {
  try {
    findEntitySuggestions();
    deriveEntityLinks();
  } catch (e) {
    console.warn("[entities] proposals:", e);
  }
}

function records(kind: EntityKind): SourceRecord[] {
  refresh();
  return listEntities(kind).flatMap((e) => {
    const d = entityDetail(e.ref);
    if (!d) return [];
    const rel = (r: string) => d.links.filter((l) => l.rel === r).map((l) => l.label || l.target);
    const typed: SourceRecord["typed"] = [{ id: F.aliases, name: "Aliases", type: "text", value: e.aliases.join(", ") }];
    if (kind === "org") {
      typed.push(
        { id: F.domains, name: "Domains", type: "text", value: e.domains.join(", ") },
        { id: F.people, name: "People", type: "text", value: clip(d.people.map((p) => p.name), 12) },
        { id: F.projects, name: "Projects", type: "text", value: clip(d.projects.map((p) => p.name)) },
      );
    } else if (kind === "place") {
      typed.push({ id: F.address, name: "Address", type: "text", value: e.address }, { id: F.people, name: "People", type: "text", value: clip(d.people.map((p) => p.name), 12) });
    } else {
      typed.push(
        { id: F.job, name: "Job", type: "text", value: [e.address, ...rel("job")].filter(Boolean).join(", ") },
        { id: F.jira, name: "Jira", type: "text", value: rel("jira").join(", ") },
        { id: F.repos, name: "Repos", type: "text", value: rel("repo").join(", ") },
        { id: F.dbs, name: "Databases", type: "text", value: rel("db").join(", ") },
        { id: F.org, name: "Organisation", type: "text", value: rel("org").join(", ") },
        { id: F.hours, name: "Hours", type: "number", value: d.hours },
      );
    }
    typed.push({ id: F.note, name: "Note", type: "text", value: e.note });
    return [{ ref: e.ref, title: e.name, fields: {}, text: detailText({ note: "", sections: d.sections }), updatedAt: e.updatedAt, typed }];
  });
}

/** What was edited in the database goes to the entities; a row without one makes one. */
function puller(kind: EntityKind) {
  return async (_dbId: number, rows: Row[]): Promise<void> => {
    const { setCell } = await import("@/plugins/workspace/store");
    const SRC = "srcref";
    const EDITED = "srcedited";
    for (const row of rows) {
      const ref = String(row.cells[SRC] ?? "");
      const parsed = parseRef(ref);
      if (!parsed) {
        // A row of its own in the database: a new entity (the next read makes the row its).
        if (ref || !row.title.trim()) continue;
        let made: string;
        if (kind === "project") made = `project:${createProject({ title: row.title.trim(), description: String(row.cells[F.note] ?? "") || undefined }).id}`;
        else made = `${kind}:${createEntity(kind, row.title, { note: String(row.cells[F.note] ?? ""), address: kind === "place" ? String(row.cells[F.address] ?? "") || row.title : "" })}`;
        const aliases = list(row.cells[F.aliases]);
        const domains = kind === "org" ? list(row.cells[F.domains]) : [];
        if (aliases.length || domains.length) updateEntity(made, { aliases, domains });
        setCell(row.id, SRC, made);
        continue;
      }
      const e = listEntities(kind).find((x) => x.ref === ref);
      // The entity changed since the row was read: it wins (the row follows).
      if (!e || String(row.cells[EDITED] ?? "") !== e.updatedAt) continue;
      const patch: Parameters<typeof updateEntity>[1] = {};
      if (row.title.trim() && row.title !== e.name) patch.name = row.title;
      const aliases = list(row.cells[F.aliases]);
      if (aliases.join("|") !== e.aliases.join("|")) patch.aliases = aliases;
      if (kind === "org") {
        const domains = list(row.cells[F.domains]).map((d) => d.toLowerCase());
        if (domains.join("|") !== e.domains.join("|")) patch.domains = domains;
      }
      if (kind === "place" && F.address in row.cells && String(row.cells[F.address] ?? "") !== e.address) patch.address = String(row.cells[F.address] ?? "");
      const note = String(row.cells[F.note] ?? "");
      if (note !== e.note) patch.note = note;
      if (Object.keys(patch).length) updateEntity(ref, patch);
    }
  };
}

export const ORGS_SOURCE: WorkspaceSource = {
  id: "orgs",
  label: "Organisations",
  icon: "🏢",
  hint: "Organisations — from mail domains (not freemail), customers, profiles of companies and bank counterparties, confirmed in the review queue: a row each with other names, domains, the people working there and its projects; its page gathers tickets, the latest mails and the money between you. Edits go to the organisation.",
  read: () => records("org"),
  count: () => listEntities("org").length,
  pull: puller("org"),
  remove: (_dbId, ref) => deleteEntity(ref),
};

export const PROJECTS_SOURCE: WorkspaceSource = {
  id: "projects",
  label: "Projects",
  icon: "📐",
  hint: "Your projects (the time tracking's) with what belongs to them — job number, Jira keys and boards, repos, Workspace databases, the customer — and the hours booked; its page lists its open tickets and latest entries. Links are proposed in the review queue.",
  read: () => records("project"),
  count: () => listEntities("project").length,
  pull: puller("project"),
  remove: () => {
    throw new Error(t("A project is deleted in the time tracking (Projects), not here."));
  },
};

export const PLACES_SOURCE: WorkspaceSource = {
  id: "places",
  label: "Places",
  icon: "📍",
  hint: "Places — where your appointments are, people's addresses and the addresses in letters, confirmed in the review queue: a row each with its address and other names (“Büro”), the people there and its appointments. Edits go to the place.",
  read: () => records("place"),
  count: () => listEntities("place").length,
  pull: puller("place"),
  remove: (_dbId, ref) => deleteEntity(ref),
};
