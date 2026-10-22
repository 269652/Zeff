import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * The People extraction misses nothing silently: every pair of a message and a person it concerns gets a verdict — found (with
 * its claim or link) or nothing — and the pairs the answer left out, or marked found without a finding that holds, are asked
 * about once more, alone. Like the Mail-Durchsicht, which decides on every mail.
 */

const items = () => [
  { id: "m1", ref: "teams:t1", at: "2026-10-20T09:00:00Z", where: "Teams · PROJ Devs", who: "Rico Clemen", text: "Julia ist bei uns für die Abnahme und das Testing zuständig.", people: [1, 2] },
  { id: "m2", ref: "mail:x2", at: "2026-10-20T10:00:00Z", where: "Mail", who: "Julia Freidank", text: "Mein Zeichen: DR II 1121/26 — Ihr Verfahren läuft weiter.", people: [1] },
  { id: "m3", ref: "teams:t3", at: "2026-10-20T11:00:00Z", where: "Teams · PROJ Devs", who: "Rico Clemen", text: "Ich schicke dir die Figma-Nodes bis Freitag, Julia.", people: [2] },
];
const profiles = [
  { id: 1, name: "Julia Freidank", aliases: [], known: [] },
  { id: 2, name: "Rico Clemen", aliases: [], known: [] },
];
const base = { instructions: "Anweisungen.", profiles, rejected: { claims: [], links: [] }, allowed: new Set([1, 2]), personExists: (id: number) => id === 1 || id === 2 };

test("the prompt lists every pair to judge: each message with the people it concerns", async () => {
  const { extractPrompt } = await import("@/plugins/people/extract");
  const p = extractPrompt({ instructions: "x", profiles, rejected: { claims: [], links: [] }, items: items() });
  assert.match(p, /# Zu beurteilen/);
  assert.match(p, /\[m1\] → 1 Julia Freidank, 2 Rico Clemen/);
  assert.match(p, /\[m2\] → 1 Julia Freidank/);
  assert.match(p, /\[m3\] → 2 Rico Clemen/);
});

test("the schema asks for a verdict on every pair", async () => {
  const { EXTRACT_SCHEMA } = await import("@/plugins/people/extract");
  const s = EXTRACT_SCHEMA as { required: string[]; properties: Record<string, unknown> };
  assert.ok(s.required.includes("checked"));
  assert.ok(s.properties.checked);
});

test("pairs left out or marked found without a finding that holds are asked about again, alone — once", async () => {
  const { extractBatch } = await import("@/plugins/people/extract");
  const prompts: string[] = [];
  const answers = [
    // First: m1/Julia found (holds), m1/Rico nothing, m2/Julia "found" but no quote (doesn't hold), m3/Rico left out.
    {
      claims: [
        { person: 1, kind: "owns", text: "Zuständig für Abnahme und Testing", evidence: "für die Abnahme und das Testing zuständig", source: "m1", confidence: 0.9 },
        { person: 1, kind: "fact", text: "Verfahren DR II 1121/26 läuft", evidence: "", source: "m2", confidence: 0.9 },
      ],
      links: [],
      checked: [
        { source: "m1", person: 1, verdict: "gefunden" },
        { source: "m1", person: 2, verdict: "nichts" },
        { source: "m2", person: 1, verdict: "gefunden" },
      ],
    },
    // The follow-up: the two open pairs.
    {
      claims: [
        { person: 1, kind: "fact", text: "Laufendes Verfahren, Aktenzeichen DR II 1121/26", evidence: "Mein Zeichen: DR II 1121/26", source: "m2", confidence: 0.9 },
        { person: 2, kind: "commitment", text: "Schickt die Figma-Nodes bis Freitag", evidence: "Ich schicke dir die Figma-Nodes bis Freitag", source: "m3", confidence: 0.9, direction: "theirs" },
      ],
      links: [],
      checked: [
        { source: "m2", person: 1, verdict: "gefunden" },
        { source: "m3", person: 2, verdict: "gefunden" },
      ],
    },
  ];
  const r = await extractBatch({ ...base, items: items(), ask: async (p) => (prompts.push(p), answers[prompts.length - 1] ?? {}) });
  assert.equal(prompts.length, 2, "one follow-up");
  assert.doesNotMatch(prompts[1], /\[m1\]/, "the follow-up has only the open pairs' messages");
  assert.match(prompts[1], /\[m2\]/);
  assert.match(prompts[1], /\[m3\]/);
  assert.match(prompts[1], /noch nicht beurteilt/);
  assert.deepEqual(r.claims.map((c) => `${c.personId}@${c.sourceRef}`).sort(), ["1@mail:x2", "1@teams:t1", "2@teams:t3"]);
  assert.deepEqual(r.open, [], "every pair judged");
});

test("nothing is asked again when every pair is judged; a follow-up that still leaves pairs open stops (they are reported)", async () => {
  const { extractBatch } = await import("@/plugins/people/extract");
  let calls = 0;
  const all = { claims: [], links: [], checked: [{ source: "m1", person: 1, verdict: "nichts" }, { source: "m1", person: 2, verdict: "nichts" }, { source: "m2", person: 1, verdict: "nichts" }, { source: "m3", person: 2, verdict: "nichts" }] };
  const r1 = await extractBatch({ ...base, items: items(), ask: async () => (calls++, all) });
  assert.equal(calls, 1);
  assert.deepEqual(r1.open, []);
  calls = 0;
  const r2 = await extractBatch({ ...base, items: items(), ask: async () => (calls++, { claims: [], links: [], checked: [] }) });
  assert.equal(calls, 2, "asked once more, then it stops");
  assert.deepEqual(r2.open.sort(), ["1@m1", "1@m2", "2@m1", "2@m3"]);
});

test("a message where someone writes about a ticket, project, topic or task is at least a knows-about link — no judgment call", async () => {
  const { extractPrompt } = await import("@/plugins/people/extract");
  const p = extractPrompt({ instructions: "x", profiles, rejected: { claims: [], links: [] }, items: items() });
  assert.match(p, /mindestens eine Verbindung knows-about/);
  assert.match(p, /übernimmt.*owns/);
});

test("batches of 20 messages (more attention per pair); the eval cuts its cases the same", async () => {
  const { PER_BATCH, MAX_BATCHES } = await import("@/plugins/people/extract");
  assert.equal(PER_BATCH, 20);
  assert.equal(PER_BATCH * MAX_BATCHES, 120, "as many messages a run as before");
});
