/**
 * The People extraction as an eval step: the messages its past claims and links came from — a claim or link you
 * confirmed: must; rejected: negative; still proposed: open. An item is a person and a message
 * (`<personId>@<sourceRef>`): "the AI found something about this person in this message" (its words vary, the
 * finding is what counts). Frozen as the step reads them (the same texts, who they concern), in batches of 40, with
 * the profiles concerned — what is known of them already, but not what this case is about (that would say "don't
 * find it again") — and what you rejected elsewhere. A run: the step's prompt builder, one AI call (no retrieval
 * rounds), the step's own checks (a quote, a source of the batch, enough confidence).
 */
import { getSqlite } from "@/db";
import type { ExtractItem, ExtractProfile } from "@/plugins/people/extract";
import type { EvalAdapter, EvalCase, Label } from "../harness";
import { mergeLabel } from "../golden";

export type PeopleInput = { profiles: ExtractProfile[]; rejected: { claims: string[]; links: string[] }; items: ExtractItem[]; /** Every profile's id (a link to a person must name one). */ people: number[] };

const PER_CASE = 40;
/** The step reads back 14 days on its first run: a claim's message is at most that much older than the claim. */
const LOOK_BACK_DAYS = 15;

const LABEL: Record<string, Label> = { confirmed: "must", rejected: "negative", proposed: "open" };

export const peopleAdapter: EvalAdapter<PeopleInput> = {
  step: "people",
  title: "Personen-Extraktion",
  task: "people-normalize",
  prompt: { file: "src/plugins/people/extract.ts" },
  costUsd: 0.5,
  async build() {
    const { listPeople } = await import("@/plugins/people/store");
    const { newItems } = await import("@/plugins/people/extract");
    await import("@/plugins/people/graph").then((g) => g.claimsOf(0)); // (its tables, on a database that has none yet)
    const d = getSqlite();
    const found = [
      ...(d.prepare("select person_id, source_ref, status, created_at from people_claims where source_ref != ''").all() as { person_id: number; source_ref: string; status: string; created_at: string }[]),
      ...(d.prepare("select person_id, source_ref, status, created_at from people_links where source = 'ai' and source_ref != ''").all() as { person_id: number; source_ref: string; status: string; created_at: string }[]),
    ];
    if (!found.length) return [];
    const labels: Record<string, Label> = {};
    for (const f of found) {
      const k = `${f.person_id}@${f.source_ref}`;
      labels[k] = mergeLabel(labels[k], LABEL[f.status] ?? "open");
    }
    const people = listPeople();
    const oldest = found.reduce((m, f) => (f.created_at < m ? f.created_at : m), found[0].created_at);
    const days = Math.ceil((Date.now() - Date.parse(oldest)) / 864e5) + LOOK_BACK_DAYS;
    const ids = [...new Set(found.map((f) => f.person_id))];
    const refs = new Set(found.map((f) => f.source_ref));
    const items = newItems(people, days, ids).items.filter((i) => refs.has(i.ref));
    const cases: EvalCase<PeopleInput>[] = [];
    const byId = new Map(people.map((p) => [p.id, p]));
    for (let i = 0; i < items.length; i += PER_CASE) {
      const batch = items.slice(i, i + PER_CASE).map((it, n) => ({ ...it, id: `m${n + 1}` }));
      const caseRefs = new Set(batch.map((b) => b.ref));
      const involved = [...new Set(batch.flatMap((b) => b.people))].map((id) => byId.get(id)).filter((p) => !!p);
      const notHere = (r: { source_ref: string }) => !caseRefs.has(r.source_ref);
      const profiles = involved.map((p) => ({
        id: p.id,
        name: p.name,
        aliases: p.aliases,
        known: (d.prepare("select text, source_ref from people_claims where person_id = ? and status in ('proposed', 'confirmed') order by status = 'confirmed' desc, confidence desc, id desc").all(p.id) as { text: string; source_ref: string }[])
          .filter(notHere)
          .slice(0, 6)
          .map((r) => r.text),
      }));
      const rejected = {
        claims: (d.prepare("select p.name, c.text, c.source_ref from people_claims c join people p on p.id = c.person_id where c.status = 'rejected' order by c.id desc limit 100").all() as { name: string; text: string; source_ref: string }[])
          .filter(notHere)
          .slice(0, 25)
          .map((r) => `${r.name}: ${r.text}`),
        links: (d.prepare("select p.name, l.rel, l.target_ref, l.source_ref from people_links l join people p on p.id = l.person_id where l.status = 'rejected' and l.source = 'ai' order by l.id desc limit 100").all() as { name: string; rel: string; target_ref: string; source_ref: string }[])
          .filter(notHere)
          .slice(0, 25)
          .map((r) => `${r.name} ${r.rel} ${r.target_ref}`),
      };
      // The items of the case: a person and a message the message concerns (others the step can't find).
      const caseLabels: Record<string, Label> = {};
      const what: Record<string, string> = {};
      for (const b of batch)
        for (const pid of b.people) {
          const k = `${pid}@${b.ref}`;
          if (!labels[k]) continue;
          caseLabels[k] = labels[k];
          what[k] = `${byId.get(pid)?.name ?? pid} in ${b.where} (${b.at.slice(0, 10)}): „${b.text.replace(/\s+/g, " ").slice(0, 70)}“`;
        }
      if (Object.keys(caseLabels).length) cases.push({ id: `people-${cases.length + 1}`, input: { profiles, rejected, items: batch, people: people.map((p) => p.id) }, labels: caseLabels, what });
    }
    return cases;
  },
  async run(c, instructions, ask) {
    const { extractBatch } = await import("@/plugins/people/extract");
    const { profiles, rejected, items } = c.input;
    const everyone = new Set(c.input.people);
    // The step's own way through a batch: every pair judged, the open ones asked about again.
    const found = await extractBatch({
      ask: async (prompt, schema) => ((await ask(prompt, schema, { task: "people-normalize", step: "people" })) ?? {}) as never,
      instructions,
      profiles,
      rejected,
      items: items.map((i) => ({ ...i })),
      allowed: new Set(profiles.map((p) => p.id)),
      personExists: (id) => everyone.has(id),
    });
    return new Set([...found.claims, ...found.links].map((f) => `${f.personId}@${f.sourceRef}`));
  },
};
