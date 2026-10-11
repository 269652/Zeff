/** The knowledge server's answers, as Zeff shows them (client-safe). */
export type KnowledgePage = {
  id: string;
  title: string;
  space: string;
  url: string;
  summary: string | null;
  snippet: string;
  heading: string;
  score: number;
  updatedAt: string | null;
  /** Why it helps with the todo (the Wissens-Zuordnung's one line, in the UI language; "" when it gave none, missing when picked before). */
  why?: string;
};
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

/** Where a page comes from: a Confluence space, a Keep board or one of Zeff's own sources (Todos, Jira, Mail …). */
export type PageSource = "confluence" | "keep" | "zeff";
export const pageSource = (p: { id: string; space: string }): PageSource =>
  p.id.startsWith("zeff:") ? "zeff" : p.id.startsWith("keep:") || /^(Keep · |Google Keep$)/.test(p.space) ? "keep" : "confluence";

/** The page's place, short: "Todos" for "Zeff · Todos", the board for "Keep · Zeff", the space for Confluence. */
export const pagePlace = (p: { space: string }): string => p.space.replace(/^(Zeff|Keep) · /, "");

/** A found passage, readable: checkboxes and list markers become " · ", whitespace one space. */
export const cleanSnippet = (s: string): string =>
  s
    .replace(/(^|\s)[-*•]\s*\[[ xX]?\]\s*/g, " · ")
    .replace(/(^|\s)[-*•]\s+/g, " · ")
    .replace(/\s+/g, " ")
    .replace(/^\s*·\s*/, "")
    .trim();

/** The pages worth showing for a todo: not the todo itself (the knowledge has every todo too). */
export const pagesFor = (pages: KnowledgePage[], todoId?: number): KnowledgePage[] => pages.filter((p) => todoId === undefined || p.id !== `zeff:todo:${todoId}`);

/** The entities worth a chip: not documents or tickets (the pages are there), nor one a page title names. */
export const entitiesFor = (entities: KnowledgeEntity[], pages: KnowledgePage[]): KnowledgeEntity[] =>
  entities.filter((e) => !["document", "ticket"].includes(e.type.toLowerCase()) && !pages.some((p) => p.title.toLowerCase().includes(e.name.toLowerCase())));

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
