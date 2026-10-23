import { ENTITY_TYPES, compileRunning, keyOf } from "./compile";
import { db, endRun, getSettings, startRun } from "./db";
import { ai, backendFor } from "./llm";

/**
 * Normalizing the entities: compiling makes one entity per name, so the same person or thing ends
 * up as several — "Max Mustermann", "Max", "Verfasser"; "PROJ-123", "PROJ 123"; "Fileadmin",
 * "fileadmin-Ordner". This finds them and makes them one, apart from compiling, when you run it:
 *
 * 1. Candidates, without AI: names alike — the same written together, a typo apart, one inside
 *    the other ("Max" in "Max Mustermann"), a first name the start of another ("Chris"), a
 *    name another one's alias. Every person (and every word for "me": Ich, Verfasser, Autor …)
 *    goes to the AI anyway, all together: who's who needs the whole list.
 * 2. The AI says which really are the same (not just related) and how the one should be named.
 * 3. Its proposals wait for you (or are taken at once): merging moves the pages and relations to
 *    the one that stays, the other names become its aliases — and their keys point to it
 *    (entity_keys), so compiling finds it again instead of making them anew.
 */

/** Words for the knowledge's owner (the one whose notes, chats and mails these are) — with the owner (settings) merged. */
const OWNER_WORDS = new Set(["ich", "mir", "mich", "selbst", "verfasser", "verfasserin", "autor", "autorin", "author", "ersteller", "erstellerin", "nutzer", "nutzerin", "benutzer", "user", "owner", "inhaber", "kontoinhaber", "me", "myself", "i"]);

type Ent = { id: number; key: string; name: string; type: string; aliases: string[]; summary: string; pages: number; degree: number };

export type Proposal = { id: number; keepId: number; ids: number[]; name: string; type: string; reason: string; status: "pending" | "applied" | "rejected"; createdAt: string };
export type ProposalView = Proposal & { members: { id: number; name: string; type: string; pages: number; summary: string }[] };

const parse = <T>(s: string, d: T): T => {
  try {
    return JSON.parse(s) as T;
  } catch {
    return d;
  }
};

function entities(): Ent[] {
  type R = { id: number; key: string; name: string; type: string; aliases: string; summary: string; pages: number; degree: number };
  return (
    db()
      .prepare(
        `select e.id, e.key, e.name, e.type, e.aliases, e.summary,
           (select count(*) from entity_pages ep where ep.entity_id = e.id) pages,
           (select count(*) from relations r where r.src = e.id or r.dst = e.id) degree
         from entities e`,
      )
      .all() as R[]
  ).map((r) => ({ ...r, aliases: parse<string[]>(r.aliases, []) }));
}

// ---------------------------------------------------------------------------
// 1. Candidates
// ---------------------------------------------------------------------------

const compact = (k: string) => k.replace(/ /g, "");
const digits = (k: string) => (k.match(/\d+/g) ?? []).join(" ");
/** A group of candidates at most this big (the same name written differently may make bigger ones). */
const MAX_GROUP = 25;

/** Edit distance, stopping once it's over `max`. */
function within(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]);
    }
    if (best > max) return false;
    prev = cur;
  }
  return prev[b.length] <= max;
}

/** Groups of entities that might be one (union-find over the signals above); persons apart. */
function candidateBlocks(all: Ent[]): Ent[][] {
  const parent = new Map<number, number>(all.map((e) => [e.id, e.id]));
  const size = new Map<number, number>(all.map((e) => [e.id, 1]));
  const find = (x: number): number => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  // Joined only while the group stays small: weak signals would otherwise chain half the graph into one.
  const join = (a: number, b: number, max = MAX_GROUP) => {
    const [x, y] = [find(a), find(b)];
    if (x === y || size.get(x)! + size.get(y)! > max) return;
    parent.set(x, y);
    size.set(y, size.get(x)! + size.get(y)!);
  };
  const others = all.filter((e) => e.type !== "person" && !OWNER_WORDS.has(e.key));
  // The keys an entity goes by: its name's, its aliases'.
  const keysOf = (e: Ent) => [...new Set([e.key, ...e.aliases.map(keyOf)].filter(Boolean))];
  const byKey = new Map<string, number[]>();
  const byCompact = new Map<string, number[]>();
  const byToken = new Map<string, number[]>();
  for (const e of others) {
    for (const k of keysOf(e)) {
      byKey.set(k, [...(byKey.get(k) ?? []), e.id]);
      byCompact.set(compact(k), [...(byCompact.get(compact(k)) ?? []), e.id]);
    }
    for (const t of new Set(e.key.split(" ").filter((t) => t.length >= 3 && !/^\d+$/.test(t)))) byToken.set(t, [...(byToken.get(t) ?? []), e.id]);
  }
  // The same key or written together the same (an alias of one the name of another; "PROJ 123" / "PROJ-123" / "bmg123").
  for (const ids of [...byKey.values(), ...byCompact.values()]) for (const id of ids.slice(1)) join(ids[0], id, 80);
  // One name all inside another ("Fileadmin" / "Fileadmin Ordner") — through tokens not too common to mean anything.
  const byId = new Map(others.map((e) => [e.id, e]));
  for (const [t, ids] of byToken) {
    if (ids.length > 12) continue;
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) {
        const a = byId.get(ids[i])!.key.split(" ");
        const b = byId.get(ids[j])!.key.split(" ");
        const [short, long] = a.length <= b.length ? [a, b] : [b, a];
        if (short.includes(t) && short.every((w) => long.includes(w))) join(ids[i], ids[j]);
      }
  }
  // A typo apart (longer names): neighbours in sorted order, same first letter.
  const sorted = [...others].filter((e) => compact(e.key).length >= 6).sort((a, b) => compact(a.key).localeCompare(compact(b.key)));
  for (let i = 0; i < sorted.length; i++)
    for (let j = i + 1; j < Math.min(sorted.length, i + 8); j++) {
      const [a, b] = [compact(sorted[i].key), compact(sorted[j].key)];
      // Numbers aren't typos: "PROJ-131" and "PROJ-138", "Release 1.49.3" and "1.49.10" are different things.
      if (a[0] === b[0] && digits(a) === digits(b) && within(a, b, a.length >= 12 ? 2 : 1)) join(sorted[i].id, sorted[j].id);
    }
  const groups = new Map<number, Ent[]>();
  for (const e of others) groups.set(find(e.id), [...(groups.get(find(e.id)) ?? []), e]);
  return [...groups.values()].filter((g) => g.length > 1);
}

/** Every person and every word for the owner, sorted by name: the AI sees who's who all at once (in parts when there are very many). */
function personBlocks(all: Ent[]): Ent[][] {
  const people = all.filter((e) => e.type === "person" || OWNER_WORDS.has(e.key)).sort((a, b) => a.key.localeCompare(b.key));
  if (people.length <= 1) return [];
  const PART = 220;
  if (people.length <= PART) return [people];
  // Very many: in parts by name — the owner words with every part, and each part overlapping the next a little.
  const owner = people.filter((e) => OWNER_WORDS.has(e.key));
  const rest = people.filter((e) => !OWNER_WORDS.has(e.key));
  const out: Ent[][] = [];
  for (let i = 0; i < rest.length; i += PART - 20) out.push([...owner, ...rest.slice(i, i + PART)]);
  return out;
}

// ---------------------------------------------------------------------------
// 2. The AI
// ---------------------------------------------------------------------------

type Answer = { groups: { ids: number[]; keep: number; name: string; type: string; reason: string }[] };

const SCHEMA = {
  type: "object",
  required: ["groups"],
  properties: {
    groups: {
      type: "array",
      items: {
        type: "object",
        required: ["ids", "keep", "name", "type", "reason"],
        properties: {
          ids: { type: "array", items: { type: "integer" } },
          keep: { type: "integer" },
          name: { type: "string" },
          type: { type: "string", enum: [...ENTITY_TYPES] },
          reason: { type: "string" },
        },
      },
    },
  },
};

const line = (e: Ent) => `${e.id} | ${e.type} | ${e.name}${e.aliases.length ? ` | auch: ${e.aliases.slice(0, 6).join(", ")}` : ""} | ${e.pages} Seiten | ${e.summary.replace(/\s+/g, " ").slice(0, 140)}`;

function promptOf(blocks: Ent[][], owner: string): string {
  return `Du räumst die Wissensbasis eines Menschen auf: Beim Auswerten seiner Seiten (Confluence, Notizen, Chats, Mails) ist pro Name eine Entität entstanden — dieselbe Person, dasselbe System, derselbe Begriff steht deshalb oft mehrfach da ("Max Mustermann", "Max", "Verfasser"; "PROJ-123" und "PROJ 123"; "Fileadmin" und "Fileadmin-Ordner").
${owner ? `Die Wissensbasis gehört ${owner}. Wörter wie "Ich", "Verfasser", "Autor", "Nutzer", "Owner" meinen ${owner} — führe sie mit ${owner} zusammen.` : `Die Wissensbasis gehört einer Person (ihre eigenen Notizen, Chats, Mails). Wörter wie "Ich", "Verfasser", "Autor" meinen sie — führe sie mit ihr zusammen, wenn sie in der Liste klar erkennbar ist (z. B. wer mit Abstand auf den meisten Seiten steht), sonst nicht.`}

Unten stehen Gruppen von Entitäten (je Zeile: id | Typ | Name | auch: andere Schreibweisen | Seiten | was sie ist). Finde in jeder Gruppe die, die WIRKLICH dasselbe meinen, und gib sie als Zusammenführung zurück:
- Zusammenführen nur, was sicher dasselbe ist: dieselbe Person (Vorname, Spitzname, Kürzel, Benutzername, Mailadresse), dasselbe System in anderer Schreibweise, derselbe Begriff in anderer Sprache oder Form (Singular/Plural, Abkürzung/ausgeschrieben).
- NICHT zusammenführen, was nur verwandt ist: ein Teil und sein Ganzes, ein System und sein Server, ein Projekt und sein Ticket, zwei Versionen, zwei verschiedene Leute mit gleichem Vornamen (im Zweifel getrennt lassen — lieber eine Zusammenführung zu wenig als eine falsche).
- Je Zusammenführung: ids (alle, die eins sind — nur ids aus der Liste), keep (die id, die bleibt: die mit dem besten Namen, sonst die mit den meisten Seiten), name (der beste, vollständige, übliche Name — bei Personen Vor- und Nachname, wenn bekannt), type (der passende Typ), reason (ein kurzer Satz, woran man es erkennt).
- Was nichts Gleiches hat, lass weg. Gruppen dürfen leer ausgehen. Antworte nur mit JSON nach diesem Schema:
${JSON.stringify(SCHEMA)}

${blocks.map((b, i) => `=== Gruppe ${i + 1}\n${b.map(line).join("\n")}`).join("\n\n")}`;
}

/** Blocks into calls of a sensible size — a block stays whole (a very big one alone). */
function calls(blocks: Ent[][]): Ent[][][] {
  const MAX = 160;
  const out: Ent[][][] = [];
  let cur: Ent[][] = [];
  let n = 0;
  for (const b of [...blocks].sort((a, c) => c.length - a.length)) {
    if (cur.length && n + b.length > MAX) {
      out.push(cur);
      cur = [];
      n = 0;
    }
    cur.push(b);
    n += b.length;
  }
  if (cur.length) out.push(cur);
  return out;
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

const state = globalThis as unknown as { __knowledgeNormalize?: Promise<NormalizeResult> | null; __knowledgeNormalizeStop?: boolean; __knowledgeNormalizeProgress?: string };
export type NormalizeResult = { ok: boolean; message: string; proposals: number; applied: number };
export const normalizeRunning = () => !!state.__knowledgeNormalize;
export const normalizeProgress = () => (state.__knowledgeNormalize ? (state.__knowledgeNormalizeProgress ?? "") : "");
export function stopNormalize(): boolean {
  if (!state.__knowledgeNormalize) return false;
  state.__knowledgeNormalizeStop = true;
  return true;
}

const sameSet = (a: number[], b: number[]) => a.length === b.length && a.every((x) => b.includes(x));

/**
 * The AI's merges made consistent across its calls: those it gave the same name are one (persons
 * come in parts — "Verfasser + Autor" in one, "Max + Max Mustermann" in another, both named
 * "Max Mustermann"); an entity already called that joins and stays (no two of the same name).
 */
function consolidate(found: Answer["groups"], all: Ent[]): Answer["groups"] {
  const byName = new Map<string, Answer["groups"][number]>();
  for (const g of found) {
    const k = keyOf(g.name) || `#${g.keep}`;
    const prev = byName.get(k);
    if (prev) {
      prev.ids = [...new Set([...prev.ids, ...g.ids])];
      prev.reason = [prev.reason, g.reason].filter(Boolean).join(" · ").slice(0, 300);
    } else byName.set(k, { ...g, ids: [...g.ids] });
  }
  const grouped = new Set([...byName.values()].flatMap((g) => g.ids));
  const byKey = new Map(all.map((e) => [e.key, e]));
  for (const [k, g] of byName) {
    const named = byKey.get(k);
    if (!named) continue;
    if (!g.ids.includes(named.id) && !grouped.has(named.id)) g.ids.push(named.id);
    if (g.ids.includes(named.id)) g.keep = named.id;
  }
  return [...byName.values()].filter((g) => g.ids.length > 1);
}

/**
 * Find the entities that are one (the AI, over the candidates) — as proposals, or (`apply`) merged
 * at once. Proposals still waiting are replaced; ones you rejected aren't proposed again.
 */
export function normalizeEntities({ apply = false } = {}): Promise<NormalizeResult> {
  if (state.__knowledgeNormalize) return state.__knowledgeNormalize;
  const run = (async (): Promise<NormalizeResult> => {
    const runId = startRun("normalize");
    state.__knowledgeNormalizeStop = false;
    try {
      if (compileRunning()) throw new Error("Compiling right now — normalize afterwards.");
      const all = entities();
      const byId = new Map(all.map((e) => [e.id, e]));
      const blocks = [...personBlocks(all), ...candidateBlocks(all)];
      const work = calls(blocks);
      const owner = getSettings().owner.trim();
      const rejected = (db().prepare("select ids from entity_merge_proposals where status = 'rejected'").all() as { ids: string }[]).map((r) => parse<number[]>(r.ids, []));
      const found: Answer["groups"] = [];
      const taken = new Set<number>();
      let done = 0;
      let failed = 0;
      const PARALLEL = 3;
      let next = 0;
      const worker = async () => {
        while (next < work.length && !state.__knowledgeNormalizeStop) {
          const batch = work[next++];
          const allowed = new Set(batch.flat().map((e) => e.id));
          try {
            const r = await ai<Answer>("compile", promptOf(batch, owner), SCHEMA, { timeoutMs: 300000 });
            for (const g of r.output?.groups ?? []) {
              // Only ids of this call, each once, at least two; what stays among them.
              const ids = [...new Set((g.ids ?? []).map(Number))].filter((id) => allowed.has(id) && byId.has(id) && !taken.has(id));
              if (ids.length < 2) continue;
              const keep = ids.includes(Number(g.keep)) ? Number(g.keep) : ids.sort((a, b) => byId.get(b)!.pages - byId.get(a)!.pages)[0];
              if (rejected.some((x) => sameSet(x, ids) || ids.every((id) => x.includes(id)))) continue;
              ids.forEach((id) => taken.add(id));
              const type = (ENTITY_TYPES as readonly string[]).includes(g.type) ? g.type : byId.get(keep)!.type;
              found.push({ ids, keep, name: String(g.name ?? "").trim() || byId.get(keep)!.name, type, reason: String(g.reason ?? "").slice(0, 300) });
            }
          } catch (e) {
            failed++;
            console.warn(`[knowledge normalize] ${e instanceof Error ? e.message : String(e)}`);
          }
          done++;
          state.__knowledgeNormalizeProgress = `${done} of ${work.length} calls · ${found.length} merges found`;
        }
      };
      state.__knowledgeNormalizeProgress = `0 of ${work.length} calls (${blocks.reduce((n, b) => n + b.length, 0)} candidates in ${blocks.length} groups)`;
      await Promise.all(Array.from({ length: Math.min(PARALLEL, work.length) }, worker));
      const groups = consolidate(found, all).filter((g) => !rejected.some((x) => sameSet(x, g.ids) || g.ids.every((id) => x.includes(id))));
      // Proposals: those waiting replaced by these.
      const d = db();
      const now = new Date().toISOString();
      d.prepare("delete from entity_merge_proposals where status = 'pending'").run();
      const ins = d.prepare("insert into entity_merge_proposals (run_id, keep_id, ids, name, type, reason, status, created_at) values (?, ?, ?, ?, ?, ?, 'pending', ?)");
      const newIds = groups.map((g) => Number(ins.run(runId, g.keep, JSON.stringify(g.ids), g.name, g.type, g.reason, now).lastInsertRowid));
      let applied = 0;
      if (apply) for (const id of newIds) applied += applyProposal(id) ? 1 : 0;
      const w = backendFor("compile");
      const stopped = !!state.__knowledgeNormalizeStop;
      const message = `${stopped ? "Stopped: " : ""}${groups.length} merges found${apply ? `, ${applied} applied` : " — waiting for you"} (${blocks.length} candidate groups, ${done} calls, ${w.backend === "claude" ? "Claude CLI" : "Copilot CLI"}${w.model ? ` · ${w.model}` : ""})${failed ? `, ${failed} calls failed` : ""}.`;
      endRun(runId, failed < done || done === 0, message);
      return { ok: true, message, proposals: groups.length, applied };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      endRun(runId, false, message);
      return { ok: false, message, proposals: 0, applied: 0 };
    }
  })().finally(() => {
    state.__knowledgeNormalize = null;
    state.__knowledgeNormalizeStop = false;
    state.__knowledgeNormalizeProgress = "";
  });
  state.__knowledgeNormalize = run;
  return run;
}

// ---------------------------------------------------------------------------
// 3. Merging
// ---------------------------------------------------------------------------

/**
 * Make entities one: `keep` stays (named `name`, of `type`), the others' pages and relations move
 * to it, their names become its aliases, their keys (and aliases') point to it — compiling finds
 * it under them from now on. Relations that became doubles or point at itself go.
 */
export function mergeEntities(keep: number, ids: number[], name: string, type: string, reason = ""): number {
  const d = db();
  const others = [...new Set(ids)].filter((id) => id !== keep);
  let merged = 0;
  d.transaction(() => {
    type R = { id: number; key: string; name: string; type: string; aliases: string; summary: string };
    const target = d.prepare("select id, key, name, type, aliases, summary from entities where id = ?").get(keep) as R | undefined;
    if (!target) return;
    const rows = others.map((id) => d.prepare("select id, key, name, type, aliases, summary from entities where id = ?").get(id) as R | undefined).filter((r): r is R => !!r);
    if (!rows.length && name.trim() === target.name && type === target.type) return;
    const now = new Date().toISOString();
    const finalName = name.trim() || target.name;
    // Its key: the new name's — unless another entity (not one of these) has that one.
    const wanted = keyOf(finalName);
    const owner = wanted ? (d.prepare("select id from entities where key = ?").get(wanted) as { id: number } | undefined) : undefined;
    const freed = new Set(rows.map((r) => r.key));
    const key = wanted && (!owner || owner.id === keep || freed.has(wanted)) ? wanted : target.key;
    const names = [target.name, ...parse<string[]>(target.aliases, []), ...rows.flatMap((r) => [r.name, ...parse<string[]>(r.aliases, [])])];
    const aliases = [...new Set(names.map((a) => a.trim()).filter((a) => a && keyOf(a) !== key))].slice(0, 40);
    const summary = target.summary || rows.map((r) => r.summary).sort((a, b) => b.length - a.length)[0] || "";
    const pointKey = d.prepare("insert into entity_keys (key, entity_id, created_at) values (?, ?, ?) on conflict(key) do update set entity_id = excluded.entity_id");
    for (const r of rows) {
      d.prepare("insert or ignore into entity_pages (entity_id, page_id) select ?, page_id from entity_pages where entity_id = ?").run(keep, r.id);
      d.prepare(
        `insert or ignore into relations (src, dst, rel, fact, page_id)
         select case when src = ? then ? else src end, case when dst = ? then ? else dst end, rel, fact, page_id from relations where src = ? or dst = ?`,
      ).run(r.id, keep, r.id, keep, r.id, r.id);
      d.prepare("delete from relations where src = ? or dst = ?").run(r.id, r.id);
      d.prepare("update entity_keys set entity_id = ? where entity_id = ?").run(keep, r.id);
      d.prepare("delete from entities_fts where entity_id = ?").run(r.id);
      d.prepare("delete from entities where id = ?").run(r.id);
      d.prepare("insert into entity_merges (into_id, into_name, from_name, from_type, reason, at) values (?, ?, ?, ?, ?, ?)").run(keep, finalName, r.name, r.type, reason, now);
      merged++;
    }
    d.prepare("delete from relations where src = dst").run();
    d.prepare("update entities set key = ?, name = ?, type = ?, aliases = ?, summary = ?, updated_at = ? where id = ?").run(key, finalName, type, JSON.stringify(aliases), summary, now, keep);
    // Every name it went by (except its own key) → it; a key that's an entity's own stays that entity's.
    const isEntityKey = d.prepare("select 1 from entities where key = ?");
    for (const k of new Set([target.key, ...rows.map((r) => r.key), ...aliases.map(keyOf)])) if (k && k !== key && k.length <= 80 && !isEntityKey.get(k)) pointKey.run(k, keep, now);
    d.prepare("delete from entity_keys where key = ?").run(key);
    d.prepare("delete from entities_fts where entity_id = ?").run(keep);
    d.prepare("insert into entities_fts (name, aliases, summary, entity_id) values (?, ?, ?, ?)").run(finalName, aliases.join(", "), summary, keep);
  })();
  return merged;
}

// ---------------------------------------------------------------------------
// Proposals
// ---------------------------------------------------------------------------

type PRow = { id: number; keep_id: number; ids: string; name: string; type: string; reason: string; status: Proposal["status"]; created_at: string };
const toProposal = (r: PRow): Proposal => ({ id: r.id, keepId: r.keep_id, ids: parse<number[]>(r.ids, []), name: r.name, type: r.type, reason: r.reason, status: r.status, createdAt: r.created_at });

/** The proposals waiting — with their entities as they are now (one gone meanwhile: left out; fewer than two: no proposal any more). */
export function pendingProposals(): ProposalView[] {
  const d = db();
  const one = d.prepare("select e.id, e.name, e.type, e.summary, (select count(*) from entity_pages ep where ep.entity_id = e.id) pages from entities e where e.id = ?");
  return (d.prepare("select * from entity_merge_proposals where status = 'pending' order by id").all() as PRow[])
    .map(toProposal)
    .map((p) => ({ ...p, members: p.ids.map((id) => one.get(id) as ProposalView["members"][number] | undefined).filter((m): m is ProposalView["members"][number] => !!m) }))
    .filter((p) => p.members.length > 1 && p.members.some((m) => m.id === p.keepId));
}

/** A proposal taken: merged (under `name`, when you changed it). False when it isn't there (any more). */
export function applyProposal(id: number, name?: string): boolean {
  const d = db();
  const r = d.prepare("select * from entity_merge_proposals where id = ? and status = 'pending'").get(id) as PRow | undefined;
  if (!r) return false;
  const p = toProposal(r);
  const final = name?.trim() || p.name;
  if (final !== p.name) d.prepare("update entity_merge_proposals set name = ? where id = ?").run(final, id);
  mergeEntities(p.keepId, p.ids, final, p.type, p.reason);
  d.prepare("update entity_merge_proposals set status = 'applied' where id = ?").run(id);
  return true;
}

/** A proposal rejected: not proposed again (the same entities, or some of them). */
export function rejectProposal(id: number): void {
  db().prepare("update entity_merge_proposals set status = 'rejected' where id = ? and status = 'pending'").run(id);
}

/** All waiting proposals taken. */
export function applyAll(): number {
  return pendingProposals().reduce((n, p) => n + (applyProposal(p.id) ? 1 : 0), 0);
}

/** What was merged lately. */
export function recentMerges(limit = 50): { intoId: number; intoName: string; fromName: string; fromType: string; reason: string; at: string }[] {
  return db().prepare("select into_id intoId, into_name intoName, from_name fromName, from_type fromType, reason, at from entity_merges order by id desc limit ?").all(limit) as never;
}

/** What a run would hand the AI (no AI): the candidate groups, and in how many calls. */
export function planNormalize(): { entities: number; persons: number; groups: Ent[][]; calls: number } {
  const all = entities();
  const people = personBlocks(all);
  const groups = [...people, ...candidateBlocks(all)];
  return { entities: all.length, persons: people.reduce((n, b) => n + b.length, 0), groups, calls: calls(groups).length };
}
