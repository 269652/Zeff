/** The knowledge server's answers, as Zeff shows them (client-safe). */
export type KnowledgePage = { id: string; title: string; space: string; url: string; summary: string | null; snippet: string; heading: string; score: number; updatedAt: string | null };
export type KnowledgeEntity = { id: number; name: string; type: string; summary: string; aliases: string[]; pages: number; related: { name: string; rel: string; dir: "out" | "in"; fact: string }[] };
export type KnowledgeSource = { n: number; title: string; url: string; heading: string; excerpt: string };
export type KnowledgeAnswer = { answer: string; sources: KnowledgeSource[]; entities: KnowledgeEntity[]; searchedFor: string; model: string | null; durationMs: number | null };
export type KnowledgeTurn = { role: "user" | "assistant"; text: string };
export type KnowledgeStatus = {
  counts: { pages: number; compiled: number; chunks: number; entities: number; relations: number; spaces: number };
  confluence: string | null;
  running: { sync: boolean; compile: boolean };
  runs: { id: number; kind: string; started_at: string; finished_at: string | null; ok: number | null; message: string | null }[];
};
/** A snippet's found words: ⟦…⟧. */
export const snippetParts = (s: string) => s.split(/(⟦[^⟧]*⟧)/g).map((p) => (p.startsWith("⟦") ? { mark: true, text: p.slice(1, -1) } : { mark: false, text: p }));

/** What the Wissens-Zuordnung picked for a todo: the pages and entities that fit it — when. */
export type TodoKnowledge = { at: string; pages: KnowledgePage[]; entities: KnowledgeEntity[] };

/** A todo's stored knowledge (its column), or null. */
export const parseTodoKnowledge = (raw: string | null | undefined): TodoKnowledge | null => {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as TodoKnowledge;
    return v && Array.isArray(v.pages) && Array.isArray(v.entities) ? v : null;
  } catch {
    return null;
  }
};

/** A person the knowledge knows (the knowledge server's /api/people). */
export type KnowledgePerson = { id: number; key: string; name: string; aliases: string[]; summary: string; pages: number; degree: number };

/** An entity in full (the knowledge server's /api/people/<id>): every relation with the entity on its other end and its page. */
export type KnowledgeEntityDetail = {
  id: number;
  name: string;
  type: string;
  summary: string;
  aliases: string[];
  relations: { other: { id: number; name: string; type: string }; rel: string; fact: string; dir: "out" | "in"; pageId: string; pageTitle: string }[];
  pages: { id: string; title: string; space: string; url: string; summary: string | null }[];
};
