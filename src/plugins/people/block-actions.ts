"use server";

import { headers } from "next/headers";
import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import { personBundle, personOfRow, personOp, type PersonBundle, type PersonOperation } from "./blocks";
import { getPerson, rememberEntity } from "./store";
import { currentAccountId } from "@/db/accounts";
import { pluginAction, type Result } from "@/lib/action-result";

/** What the blocks of a person's page call: the bundle of what is known, an operation, what the knowledge knows. None throws at the page. */

const run = pluginAction("people", () => t("The People plugin is not installed (Menu → Plugins)."));

const personId = (rowId: number): number => {
  const id = personOfRow(Number(rowId));
  if (!id) throw new Error(t("This row is not a person."));
  return id;
};

/** Everything the blocks of this row's page show. */
export async function personBundleAction(rowId: number): Promise<Result<{ person: PersonBundle }>> {
  return run(async () => ({ person: await personBundle(personId(rowId)) }));
}

/** An operation of a block; after it the people database reads the profiles again (its rows follow). */
export async function personOpAction(rowId: number, op: PersonOperation): Promise<Result<{ gone?: boolean; href?: string; message?: string }>> {
  return run(async () => {
    const r = await personOp(personId(rowId), op);
    let href: string | undefined;
    if (isInstalled("workspace")) {
      const { peopleDatabase, personHref } = await import("@/plugins/workspace/people-database");
      const db = peopleDatabase();
      if (db) (await import("@/plugins/workspace/pipeline")).startPipeline(db, { ai: false });
      if (r.gone) href = r.keep ? personHref(r.keep) : db ? `/workspace/${db}` : "/workspace";
    }
    return { gone: r.gone, href, message: r.message };
  });
}

export type KnowledgeOfPerson = {
  summary: string;
  related: { name: string; rels: string[] }[];
  pages: { id: string; title: string; space: string; href: string }[];
  graph: string | null;
  error: string | null;
  /** The knowledge keeps them as several entries: a merge to confirm. */
  merge?: { id: number; names: string[] } | null;
};

// Per account (a person's id is its account's database's): one account's knowledge of person 12 is never the other's.
const wikiCache = new Map<string, { at: number; wiki: KnowledgeOfPerson | null }>();
const wikiKey = (id: number) => `${currentAccountId()}:${id}`;

/** What the knowledge (the knowledge server) knows of them: by the entity kept with the profile, else by name or alias — kept five minutes, and not waited for longer than a few seconds. */
export async function personWikiAction(rowId: number): Promise<Result<{ wiki: KnowledgeOfPerson | null }>> {
  return run(async () => {
    const id = personId(rowId);
    const hit = wikiCache.get(wikiKey(id));
    if (hit && Date.now() - hit.at < 5 * 60000) return { wiki: hit.wiki };
    const wiki = await Promise.race([
      personWiki(id),
      new Promise<KnowledgeOfPerson>((resolve) => setTimeout(() => resolve({ summary: "", related: [], pages: [], graph: null, error: t("The knowledge server did not answer in time.") }), 4000)),
    ]);
    if (!wiki?.error) wikiCache.set(wikiKey(id), { at: Date.now(), wiki });
    return { wiki };
  });
}

async function personWiki(id: number): Promise<KnowledgeOfPerson | null> {
  {
    const p = getPerson(id);
    if (!p || !isInstalled("knowledge")) return null;
    try {
      const { knowledgePerson, knowledgePersons, knowledgeBrowserUrl } = await import("@/plugins/knowledge/client");
      const { knowledgeEntitiesOf } = await import("./identity");
      // Every entity that is them — the knowledge may keep someone twice, under a name the profile has only as an alias
      // (or the other way round), or by their address. The kept one first; without the list, the kept one or the name.
      const persons = await knowledgePersons().catch(() => null);
      const matched = knowledgeEntitiesOf(p, persons ?? []);
      // Several: one entry to make of them (you confirm it on the card) — the list not read, what waits stays.
      const { knowledgeMergeOf, proposeKnowledgeMerge } = await import("./knowledge-sync");
      const merge = persons ? proposeKnowledgeMerge(p.id, matched) : knowledgeMergeOf(p.id);
      const ids = [...new Set([...(p.entityId ? [p.entityId] : []), ...matched.map((e) => e.id)])].slice(0, 3);
      let entities = (await Promise.all(ids.map((eid) => knowledgePerson({ id: eid })))).filter((e) => !!e);
      if (!entities.length) for (const n of [p.name, ...p.aliases]) if ((entities = [await knowledgePerson({ name: n })].filter((e) => !!e)).length) break;
      const entity = entities[0];
      if (!entity) return { summary: "", related: [], pages: [], graph: null, error: null };
      if (entity.id !== p.entityId) rememberEntity(p.id, entity.id);
      const h = await headers();
      const base = knowledgeBrowserUrl(h.get("x-forwarded-host") ?? h.get("host"), h.get("x-forwarded-proto"));
      const related = new Map<number, { name: string; rels: string[] }>();
      const pages = new Map<string, KnowledgeOfPerson["pages"][number]>();
      const own = new Set(entities.map((e) => e.id));
      for (const e of entities) {
        for (const r of e.relations ?? []) {
          if (own.has(r.other.id)) continue;
          const g = related.get(r.other.id) ?? { name: r.other.name, rels: [] };
          const text = r.fact || `${r.dir === "out" ? "→" : "←"} ${r.rel}`;
          if (!g.rels.includes(text) && g.rels.length < 3) g.rels.push(text);
          related.set(r.other.id, g);
        }
        for (const pg of e.pages) if (!pages.has(pg.id)) pages.set(pg.id, { id: pg.id, title: pg.title, space: pg.space, href: `${base}/seite/${encodeURIComponent(pg.id)}` });
      }
      return {
        summary: [...new Set(entities.map((e) => (e.summary ?? "").trim()).filter(Boolean))].join("\n\n"),
        related: [...related.values()].slice(0, 15),
        pages: [...pages.values()].slice(0, 30),
        graph: `${base}/graph?e=${entity.id}`,
        error: null,
        merge: merge ? { id: merge.id, names: merge.names } : null,
      };
    } catch (e) {
      return { summary: "", related: [], pages: [], graph: null, error: errorMessage(e) };
    }
  }
}

/** The knowledge's entries of them made one (`merge`), or the proposal dismissed. */
export async function personKnowledgeMergeAction(rowId: number, mergeId: number, op: "merge" | "dismiss"): Promise<Result<{ entityId?: number }>> {
  return run(async () => {
    const id = personId(rowId);
    const { acceptKnowledgeMerge, knowledgeMergeOf, rejectKnowledgeMerge } = await import("./knowledge-sync");
    if (knowledgeMergeOf(id)?.id !== Number(mergeId)) throw new Error(t("This proposal is no longer open."));
    wikiCache.delete(wikiKey(id));
    if (op === "dismiss") {
      rejectKnowledgeMerge(Number(mergeId));
      return {};
    }
    const m = await acceptKnowledgeMerge(Number(mergeId));
    return { entityId: m?.keepId };
  });
}

/** The overview of the people database (its "People" view). */
export async function peopleOverviewAction(): Promise<Result<{ overview: import("./tools").PeopleOverview }>> {
  return run(async () => ({ overview: await (await import("./tools")).peopleOverview() }));
}

/** A tool of the overview; the people database reads the profiles again after it. */
export async function peopleToolAction(tool: import("./tools").PeopleTool): Promise<Result<{ message?: string; draft?: string }>> {
  return run(async () => {
    const r = await (await import("./tools")).peopleTool(tool);
    if (isInstalled("workspace")) {
      const db = (await import("@/plugins/workspace/people-database")).peopleDatabase();
      if (db) (await import("@/plugins/workspace/pipeline")).startPipeline(db, { ai: false });
    }
    return r;
  });
}
