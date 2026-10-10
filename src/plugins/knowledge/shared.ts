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
