"use server";

import { headers } from "next/headers";
import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import { personBundle, personOfRow, personOp, type PersonBundle, type PersonOperation } from "./blocks";
import { getPerson, rememberEntity } from "./store";

/** What the blocks of a person's page call: the bundle of what is known, an operation, what the knowledge knows. None throws at the page. */

type Result<T = unknown> = ({ ok: true } & T) | { ok: false; error: string };

async function run<T extends object>(fn: () => T | Promise<T>): Promise<Result<T>> {
  try {
    if (!isInstalled("people")) throw new Error(t("The People plugin is not installed (Menu → Plugins)."));
    return { ok: true, ...(await fn()) };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

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

export type KnowledgeOfPerson = { summary: string; related: { name: string; rels: string[] }[]; pages: { id: string; title: string; space: string; href: string }[]; graph: string | null; error: string | null };

/** What the knowledge (the knowledge server) knows of them: by the entity kept with the profile, else by name or alias. */
export async function personWikiAction(rowId: number): Promise<Result<{ wiki: KnowledgeOfPerson | null }>> {
  return run(async () => {
    const p = getPerson(personId(rowId));
    if (!p || !isInstalled("knowledge")) return { wiki: null };
    try {
      const { knowledgePerson, knowledgeBrowserUrl } = await import("@/plugins/knowledge/client");
      let entity = p.entityId ? await knowledgePerson({ id: p.entityId }) : null;
      if (!entity) for (const n of [p.name, ...p.aliases]) if ((entity = await knowledgePerson({ name: n }))) break;
      if (!entity) return { wiki: { summary: "", related: [], pages: [], graph: null, error: null } };
      if (entity.id !== p.entityId) rememberEntity(p.id, entity.id);
      const h = await headers();
      const base = knowledgeBrowserUrl(h.get("x-forwarded-host") ?? h.get("host"), h.get("x-forwarded-proto"));
      const related = new Map<number, { name: string; rels: string[] }>();
      for (const r of entity.relations ?? []) {
        const g = related.get(r.other.id) ?? { name: r.other.name, rels: [] };
        const text = r.fact || `${r.dir === "out" ? "→" : "←"} ${r.rel}`;
        if (!g.rels.includes(text) && g.rels.length < 3) g.rels.push(text);
        related.set(r.other.id, g);
      }
      return {
        wiki: {
          summary: entity.summary ?? "",
          related: [...related.values()].slice(0, 15),
          pages: entity.pages.slice(0, 30).map((pg) => ({ id: pg.id, title: pg.title, space: pg.space, href: `${base}/seite/${encodeURIComponent(pg.id)}` })),
          graph: `${base}/graph?e=${entity.id}`,
          error: null,
        },
      };
    } catch (e) {
      return { wiki: { summary: "", related: [], pages: [], graph: null, error: errorMessage(e) } };
    }
  });
}

/** The overview of the people database (its "People" view). */
export async function peopleOverviewAction(): Promise<Result<{ overview: import("./tools").PeopleOverview }>> {
  return run(async () => ({ overview: await (await import("./tools")).peopleOverview() }));
}

/** A tool of the overview; the people database reads the profiles again after it. */
export async function peopleToolAction(tool: import("./tools").PeopleTool): Promise<Result<{ message?: string }>> {
  return run(async () => {
    const r = await (await import("./tools")).peopleTool(tool);
    if (isInstalled("workspace")) {
      const db = (await import("@/plugins/workspace/people-database")).peopleDatabase();
      if (db) (await import("@/plugins/workspace/pipeline")).startPipeline(db, { ai: false });
    }
    return r;
  });
}
