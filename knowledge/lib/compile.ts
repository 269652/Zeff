import { ai, backendFor } from "./llm";
import { db, endRun, startRun } from "./db";

/**
 * Compiling: the AI (Copilot or Claude, a plugin) reads the new and changed pages (a few at a time) and says what each is
 * about — a summary, its concepts in other words (German and English, synonyms: the search finds
 * them by meaning, not only by its words), the entities in it (systems, components, people,
 * teams, customers, processes, terms, tickets) and how they relate, each fact with its page.
 * Entities of the same name from different pages are one: that's the graph.
 */

export const ENTITY_TYPES = ["system", "component", "service", "project", "person", "team", "customer", "process", "term", "ticket", "document", "environment"] as const;

type Extracted = {
  pages: {
    id: string;
    summary: string;
    concepts: string[];
    entities: { name: string; type: string; aliases?: string[]; summary?: string }[];
    relations: { from: string; rel: string; to: string; fact?: string }[];
  }[];
};

const SCHEMA = {
  type: "object",
  required: ["pages"],
  properties: {
    pages: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "summary", "concepts", "entities", "relations"],
        properties: {
          id: { type: "string" },
          summary: { type: "string" },
          concepts: { type: "array", items: { type: "string" } },
          entities: {
            type: "array",
            items: { type: "object", required: ["name", "type"], properties: { name: { type: "string" }, type: { type: "string", enum: [...ENTITY_TYPES] }, aliases: { type: "array", items: { type: "string" } }, summary: { type: "string" } } },
          },
          relations: {
            type: "array",
            items: { type: "object", required: ["from", "rel", "to"], properties: { from: { type: "string" }, rel: { type: "string" }, to: { type: "string" }, fact: { type: "string" } } },
          },
        },
      },
    },
  },
};

const INSTRUCTIONS = `Du baust die Wissensbasis eines Menschen aus seinen Seiten: Confluence-Seiten eines Projekts — und genauso seine persönlichen Notizen, Chats (WhatsApp, Teams), Mails, Todos und Buchungen. Verarbeite JEDE Seite, auch private, persönliche oder belastende (sachlich und respektvoll — es ist seine eigene Wissensbasis, nur er sieht sie). Bei persönlichen Seiten zählt, was man sich merken will: Personen und wie sie zu ihm stehen, Daten (Geburtstage, Termine, Fristen), Orte, Absprachen, Zusagen, Vorlieben. Lies jede Seite und gib je Seite (id wie angegeben) zurück:
- summary: 2–4 Sätze, worum es geht und was man daraus wissen muss (Sprache der Seite).
- concepts: 10–25 Begriffe, unter denen man die Seite suchen würde — Synonyme, Oberbegriffe, deutsche UND englische Wörter, Abkürzungen ausgeschrieben, Fachbegriffe (z. B. "Bestelllink", "order link", "Publikation", "publication", "TYPO3", "Fluid-Template").
- entities: die wichtigen Dinge der Seite — Systeme, Komponenten, Services, Projekte, Personen, Teams, Kunden, Prozesse, Fachbegriffe, Tickets (z. B. PROJ-123), Dokumente, Umgebungen (Test, Live …). Name so, wie er üblich heißt; aliases für andere Schreibweisen; summary ein Satz, was es ist.
- relations: wie die Entitäten zusammenhängen (from/to: Namen aus entities; rel kurz, z. B. "nutzt", "gehört zu", "verantwortet", "läuft auf", "ersetzt", "dokumentiert"); fact: der Satz der Seite, der es belegt.
Nur, was auf der Seite steht — nichts erfinden. Willst oder kannst du eine Seite nicht auswerten, gib für sie summary "" und leere Listen zurück — antworte aber IMMER mit gültigem JSON, nur JSON, nach diesem Schema:
${JSON.stringify(SCHEMA)}`;

const PAGE_TEXT = 5000;
const BATCH_TEXT = 20000;
const PARALLEL = 3;

/** An entity's key: its name in lower case, without accents and punctuation — one entity per key. */
export const keyOf = (name: string) =>
  name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

type PageRow = { id: string; title: string; space: string; body: string; version: number };

function batches(list: PageRow[]): PageRow[][] {
  const out: PageRow[][] = [];
  let cur: PageRow[] = [];
  let size = 0;
  for (const p of list) {
    const n = Math.min(p.body.length, PAGE_TEXT) + p.title.length + 50;
    if (cur.length && size + n > BATCH_TEXT) {
      out.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(p);
    size += n;
  }
  if (cur.length) out.push(cur);
  return out;
}

function promptOf(list: PageRow[]): string {
  const pages = list.map((p) => `=== Seite id=${p.id} · Bereich ${p.space} · „${p.title}“\n${p.body.slice(0, PAGE_TEXT)}${p.body.length > PAGE_TEXT ? "\n[…gekürzt]" : ""}`).join("\n\n");
  return `${INSTRUCTIONS}\n\n${pages}`;
}

/** What Copilot made of a page, stored: its summary and concepts, its entities and relations (those before replaced). */
function save(page: PageRow, x: Extracted["pages"][number]): void {
  const d = db();
  const now = new Date().toISOString();
  d.transaction(() => {
    d.prepare("delete from relations where page_id = ?").run(page.id);
    d.prepare("delete from entity_pages where page_id = ?").run(page.id);
    const concepts = [...new Set((x.concepts ?? []).map((c) => c.trim()).filter(Boolean))].slice(0, 40).join(", ");
    d.prepare("update pages set summary = ?, concepts = ?, compiled_version = ?, compiled_at = ? where id = ?").run(x.summary ?? "", concepts, page.version, now, page.id);
    d.prepare("update chunks_fts set concepts = ? where page_id = ?").run(concepts, page.id);
    const ids = new Map<string, number>();
    const upsert = d.prepare(
      `insert into entities (key, name, type, aliases, summary, updated_at) values (?, ?, ?, ?, ?, ?)
       on conflict(key) do update set updated_at = excluded.updated_at,
         summary = case when length(excluded.summary) > length(entities.summary) then excluded.summary else entities.summary end
       returning id, aliases`,
    );
    // A name normalizing merged into another entity ("Moritz" → "Moritz Roessler"): that one, the name kept as an alias.
    const merged = d.prepare("select e.key from entity_keys k join entities e on e.id = k.entity_id where k.key = ?");
    for (const e of x.entities ?? []) {
      const own = keyOf(e.name ?? "");
      if (!own || own.length > 80) continue;
      const into = merged.get(own) as { key: string } | undefined;
      const key = into?.key ?? own;
      const type = (ENTITY_TYPES as readonly string[]).includes(e.type) ? e.type : "term";
      const row = upsert.get(key, e.name.trim(), type, JSON.stringify(e.aliases ?? []), e.summary ?? "", now) as { id: number; aliases: string };
      // Aliases: those it had and the new ones.
      let had: string[] = [];
      try {
        had = JSON.parse(row.aliases) as string[];
      } catch {
        had = [];
      }
      const aliases = [...new Set([...had, ...(e.aliases ?? []), ...(into ? [e.name] : [])].map((a) => a.trim()).filter((a) => a && keyOf(a) !== key))].slice(0, 30);
      d.prepare("update entities set aliases = ? where id = ?").run(JSON.stringify(aliases), row.id);
      d.prepare("insert or ignore into entity_pages (entity_id, page_id) values (?, ?)").run(row.id, page.id);
      ids.set(key, row.id);
      ids.set(own, row.id);
      for (const a of aliases) ids.set(keyOf(a), row.id);
      d.prepare("delete from entities_fts where entity_id = ?").run(row.id);
      const ent = d.prepare("select name, aliases, summary from entities where id = ?").get(row.id) as { name: string; aliases: string; summary: string };
      d.prepare("insert into entities_fts (name, aliases, summary, entity_id) values (?, ?, ?, ?)").run(ent.name, (JSON.parse(ent.aliases) as string[]).join(", "), ent.summary, row.id);
    }
    const rel = d.prepare("insert or ignore into relations (src, dst, rel, fact, page_id) values (?, ?, ?, ?, ?)");
    for (const r of x.relations ?? []) {
      const a = ids.get(keyOf(r.from ?? ""));
      const b = ids.get(keyOf(r.to ?? ""));
      if (a && b && a !== b && r.rel?.trim()) rel.run(a, b, r.rel.trim().slice(0, 60), (r.fact ?? "").slice(0, 500), page.id);
    }
  })();
}

const state = globalThis as unknown as { __knowledgeCompile?: Promise<CompileResult> | null; __knowledgeCompileStop?: boolean; __knowledgeCompileWith?: { backend: string; model: string } | null };
export type CompileResult = { ok: boolean; message: string; pages: number; batches: number; failed: number };
export const compileRunning = () => !!state.__knowledgeCompile;
/** With which CLI and model the compile running now runs (null: none runs). */
export const compilingWith = () => (state.__knowledgeCompile ? (state.__knowledgeCompileWith ?? null) : null);
/** Stop the compile: no further calls — those under way still finish (and are kept). */
export function stopCompile(): boolean {
  if (!state.__knowledgeCompile) return false;
  state.__knowledgeCompileStop = true;
  return true;
}
export const compileStopping = () => !!state.__knowledgeCompile && !!state.__knowledgeCompileStop;

/** Compile the pages not compiled in their current version — at most `maxBatches` Copilot calls this time. */
export function compilePages(maxBatches = 250): Promise<CompileResult> {
  if (state.__knowledgeCompile) return state.__knowledgeCompile;
  const run = (async (): Promise<CompileResult> => {
    const runId = startRun("compile");
    const todo = db().prepare("select id, title, space, body, version from pages where compiled_version is null or compiled_version <> version order by updated_at desc").all() as PageRow[];
    const all = batches(todo);
    const work = all.slice(0, maxBatches);
    let pages = 0;
    let failed = 0;
    state.__knowledgeCompileStop = false;
    state.__knowledgeCompileWith = backendFor("compile");
    let skipped = 0;
    const skip = (p: PageRow, why: string) => {
      skipped++;
      console.warn(`[knowledge compile] ${p.title}: ohne Auswertung übernommen (${why})`);
      save(p, { id: p.id, summary: "", concepts: [], entities: [], relations: [] });
    };
    const one = async (list: PageRow[]): Promise<void> => {
      if (state.__knowledgeCompileStop) return;
      try {
        const r = await ai<Extracted>("compile", promptOf(list), SCHEMA, { timeoutMs: 300000 });
        const byId = new Map((r.output?.pages ?? []).map((p) => [String(p.id), p]));
        const missing: PageRow[] = [];
        for (const p of list) {
          const x = byId.get(p.id);
          if (x) {
            save(p, x);
            pages++;
          } else missing.push(p);
        }
        // Pages the answer left out (the AI skips some it won't take): asked again in smaller
        // batches — a single one left out is kept as compiled, empty, not tried again each run.
        if (missing.length && list.length > 1) {
          const half = Math.ceil(missing.length / 2);
          await one(missing.slice(0, half));
          if (missing.length > half) await one(missing.slice(half));
        } else if (missing.length) skip(missing[0], "nicht in der Antwort");
      } catch (e) {
        // Too much at once (or broken JSON): halves, once.
        if (list.length > 1) {
          const half = Math.ceil(list.length / 2);
          await one(list.slice(0, half));
          await one(list.slice(half));
        } else {
          const why = e instanceof Error ? e.message : String(e);
          // A page the AI won't take (no JSON for it — e.g. too personal for it): kept as compiled,
          // empty — searchable by its text, not tried again until it changes. Other errors: next run.
          if (list[0] && /without valid JSON|no JSON/i.test(why)) skip(list[0], "keine JSON-Antwort");
          else {
            failed++;
            console.warn(`[knowledge compile] ${list[0]?.title}: ${why}`);
          }
        }
      }
    };
    // Always PARALLEL calls under way — a slow one holds up only itself, not the others.
    let calls = 0;
    let next = 0;
    const worker = async () => {
      while (next < work.length && !state.__knowledgeCompileStop) {
        const list = work[next++];
        calls++;
        await one(list);
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL, work.length) }, worker));
    const stopped = !!state.__knowledgeCompileStop;
    const w = state.__knowledgeCompileWith;
    // Entities no page names any more: gone.
    db().exec("delete from entities_fts where entity_id not in (select entity_id from entity_pages); delete from entities where id not in (select entity_id from entity_pages);");
    const left = todo.length - pages - skipped;
    const message = `${stopped ? "Angehalten: " : ""}${pages} Seiten kompiliert in ${calls} Aufrufen (${w?.backend === "claude" ? "Claude CLI" : "Copilot CLI"}${w?.model ? ` · ${w.model}` : ""})${skipped ? `, ${skipped} von der KI nicht ausgewertet (nur im Volltext)` : ""}${failed ? `, ${failed} fehlgeschlagen` : ""}${left > 0 ? `, ${left} noch offen` : ""}.`;
    endRun(runId, failed === 0 || pages > 0, message);
    return { ok: failed === 0 || pages > 0, message, pages, batches: work.length, failed };
  })().finally(() => {
    state.__knowledgeCompile = null;
    state.__knowledgeCompileStop = false;
    state.__knowledgeCompileWith = null;
  });
  state.__knowledgeCompile = run;
  return run;
}
