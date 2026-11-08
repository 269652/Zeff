/**
 * A course's research: scholarly sources on the topic (sources.ts), then Claude — with its own web search — writes the
 * plan to learn it (years → phases → skills → steps, what each requires, the paths through it), which is checked and
 * stored (store.savePlan). Runs in the background (startResearch: once per course at a time); the course page follows
 * it by the change topic "learn". Server only.
 */
import { failResearch, getCourse, savePlan, setResearching } from "./store";
import { fetchSources, type FoundSource } from "./sources";
import { normalizePlan, planShape } from "./plan";
import type { Plan } from "./shared";

/** The plan's shape for the AI (shared.ts's Plan). */
export const PLAN_SCHEMA = {
  type: "object",
  required: ["title", "summary", "years", "sources", "nodes"],
  properties: {
    title: { type: "string" },
    summary: { type: "string" },
    years: { type: "number" },
    sources: {
      type: "array",
      items: { type: "object", required: ["id", "title"], properties: { id: { type: "string" }, title: { type: "string" }, authors: { type: "string" }, year: { type: "number" }, url: { type: "string" }, kind: { type: "string", enum: ["paper", "book", "course", "web", "other"] } } },
    },
    nodes: {
      type: "array",
      items: {
        type: "object",
        required: ["key", "kind", "parent", "title"],
        properties: {
          key: { type: "string" },
          kind: { type: "string", enum: ["year", "phase", "skill", "step"] },
          parent: { type: ["string", "null"] },
          title: { type: "string" },
          summary: { type: "string" },
          objectives: { type: "array", items: { type: "string" } },
          requires: { type: "array", items: { type: "string" } },
          path: { type: "string" },
          xp: { type: "number" },
          minutes: { type: "number" },
          sources: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
} as const;

/** The research prompt (German, as Zeff's prompts are). */
export function researchPrompt(c: { topic: string; goal: string; level: string }, sources: FoundSource[]): string {
  const list = sources.length
    ? sources.map((s) => `- [${s.id}] ${s.title}${s.authors ? ` — ${s.authors}` : ""}${s.year ? ` (${s.year})` : ""}${s.citations ? `, ${s.citations}× zitiert` : ""}${s.url ? ` <${s.url}>` : ""}`).join("\n")
    : "(Die Literaturdienste haben nichts geliefert — recherchiere selbst.)";
  return `Du bist ein erfahrener Didaktiker und Fachexperte. Erstelle einen Lernplan, mit dem eine Person das folgende Thema von Grund auf erfassen und beherrschen lernt.

Thema: ${c.topic}
Ziel: ${c.goal || "das Thema gründlich verstehen und anwenden können"}
Vorwissen: ${c.level || "unbekannt — beginne bei den Grundlagen"}

Gefundene Fachliteratur (aus OpenAlex, Semantic Scholar, arXiv — nutze die Ids in eckigen Klammern):
${list}

Recherchiere zusätzlich mit der Websuche, wie das Thema üblicherweise gelehrt wird: Universitäts-Curricula und Vorlesungsverzeichnisse, Standardlehrbücher, bei Sprachen die Stufen des Gemeinsamen Europäischen Referenzrahmens (A1–C2). Füge gute Quellen, die du dabei findest, mit eigener Id (z. B. "web1") zu "sources" hinzu.

Baue daraus einen hierarchischen, mehrjährigen Plan:
- "year" → "phase" → "skill" → "step". Ein Step ist ein kleiner Trittstein (eine Lerneinheit von etwa 15–45 Minuten mit einem klaren, prüfbaren Lernziel). Jede Skill hat 3–8 Steps.
- Plane realistisch für jemanden, der neben dem Beruf lernt (etwa 3–5 Stunden pro Woche); setze "years" entsprechend (1–5).
- "requires": was vorher sitzen muss (Keys anderer Knoten — keine Zyklen). Was eine Phase voraussetzt, gilt für alles in ihr.
- "path": Gib den Skills Pfade — Richtungen, zwischen denen man wählen kann (z. B. "Grundlagen", "Riemannsche Geometrie", "Anwendungen in der Physik"; bei Sprachen "Konversation", "Grammatik", "Lesen"). Mindestens 3 Pfade im ganzen Plan, "Grundlagen" nur für das wirklich Gemeinsame.
- Der Plan ist ein Skill-Tree, ein Graph mit Breite — keine Kette: Jede Phase hat 4–8 Skills, davon stehen mehrere parallel (sie setzen dasselbe voraus, nicht einander). Ein Skill setzt nur voraus, was er wirklich braucht — oft 2 Skills aus verschiedenen Pfaden (Zusammenführung), manchmal keinen aus seiner Phase. Verzweigungen, Zusammenführungen und Wahlpfade (Vertiefungen, die man auslassen kann) sind erwünscht; "requires" von Skill zu Skill nur, wenn es fachlich nötig ist.
- Auch Steps eines Skills dürfen parallel stehen (nicht jeder Step braucht den vorigen).
- "objectives": 1–3 konkrete, prüfbare Lernziele je Knoten ("die Gaußkrümmung einer Rotationsfläche berechnen").
- "sources": Ids der passenden Quellen je Knoten. "minutes" je Step. "xp" kannst du weglassen.
- Keys sind kurz und eindeutig (y1, y1.p1, y1.p1.s1, y1.p1.s1.a …).
- Titel und Texte auf Deutsch (Fachbegriffe dürfen bleiben).

Antworte nur mit dem Plan im verlangten JSON-Format.`;
}

/** The plan sent back once because it came out as a chain: branch it out, keep its content. */
export function reworkPrompt(raw: unknown): string {
  return `Der folgende Lernplan ist zu linear: Seine Skills bilden fast eine Kette auf einem Pfad. Baue ihn zu einem echten Skill-Tree um — behalte Inhalte, Keys, Steps und Quellen, ändere vor allem "requires" und "path" (und teile Skills, wo es hilft):
- mindestens 3 Pfade, "Grundlagen" nur für das wirklich Gemeinsame;
- in jeder Phase mehrere Skills parallel (sie setzen dasselbe voraus, nicht einander), Zusammenführungen (ein Skill braucht 2 aus verschiedenen Pfaden) und Wahlpfade;
- "requires" nur, wo es fachlich nötig ist — keine Kette.

Antworte nur mit dem ganzen umgebauten Plan im verlangten JSON-Format.

${JSON.stringify(raw)}`;
}

type Deps = { fetch?: typeof fetch; ask?: (prompt: string) => Promise<unknown> };

const askClaude = async (prompt: string): Promise<unknown> => {
  const { runClaude } = await import("@/plugins/claude-cli/cli");
  const r = await runClaude<Plan>(prompt, PLAN_SCHEMA, { webSearch: true, timeoutMs: 20 * 60_000 });
  return r.output;
};

/** Research a course and store its plan (or why it failed). */
export async function runResearch(courseId: number, deps: Deps = {}): Promise<void> {
  const c = getCourse(courseId);
  if (!c) return;
  setResearching(courseId);
  try {
    const found = await fetchSources(c.topic, { fetch: deps.fetch });
    const ask = deps.ask ?? askClaude;
    let raw = (await ask(researchPrompt(c, found))) as Partial<Plan> | null;
    if (!raw || typeof raw !== "object") throw new Error("The research answered no plan.");
    // A chain isn't a skill tree: sent back once to branch out; kept as it is when the rework fails or isn't better.
    const shape = planShape(normalizePlan(raw).plan);
    if (shape.linear) {
      const again = (await ask(reworkPrompt(raw)).catch(() => null)) as Partial<Plan> | null;
      if (again && typeof again === "object" && Array.isArray(again.nodes) && !planShape(normalizePlan(again).plan).linear) raw = { ...again, sources: [...(raw.sources ?? []), ...(again.sources ?? [])] };
    }
    // The sources: what the services found (those the plan names first), and what the AI added.
    const named = new Set((raw.nodes ?? []).flatMap((n) => n.sources ?? []));
    const own = (raw.sources ?? []).filter((s) => s && !found.some((f) => f.id === s.id));
    const sources = [...found.filter((f) => named.has(f.id)), ...own, ...found.filter((f) => !named.has(f.id)).slice(0, 10)].map(({ citations: _c, ...s }: Partial<FoundSource> & { id: string; title: string }) => s);
    savePlan(courseId, { ...raw, sources });
  } catch (e) {
    failResearch(courseId, e instanceof Error ? e.message : String(e));
  }
}

const running = ((globalThis as { __zeffLearnResearch?: Set<number> }).__zeffLearnResearch ??= new Set<number>());

/** Research in the background, once per course at a time. Whether it started. */
export function startResearch(courseId: number): boolean {
  if (running.has(courseId)) return false;
  running.add(courseId);
  void runResearch(courseId).finally(() => running.delete(courseId));
  return true;
}

export const isResearching = (courseId: number) => running.has(courseId);
