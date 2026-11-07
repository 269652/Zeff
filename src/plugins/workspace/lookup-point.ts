import { extensionPoint } from "@/lib/plugin-kit/extension-point";

/**
 * Lookups plugins give the Workspace: what a view's <lookup> searches — a film at TMDB, a book, an article. A source answers each
 * keystroke with a few short hits; the one picked is then read in full, and its fields fill a row. Server only — the page asks through
 * actions/lookups.ts, and a source's keys stay here.
 */
export type LookupValue = string | number | string[] | null;
/** In what `details` gives: the text for the row's own page (not a field). */
export const LOOKUP_PAGE = "_page";
export type LookupHit = { id: string; title: string; subtitle?: string; image?: string };

export type LookupSource = {
  /** How a template names it ("tmdb.movies"). */
  id: string;
  label: string;
  /** One line for the AI: what it finds. */
  what: string;
  /** The fields a hit has, by name: what each one is (for the AI, and to check a template's map). */
  fields: Record<string, string>;
  /** What is shown with its results, where its terms ask for it. */
  credit?: string | (() => string);
  /** What it still needs, in words (a key) — null: ready. */
  missing?: () => string | null;
  /** A search takes long or costs something: not at each key, only when asked for (Enter). */
  slow?: boolean;
  /** The hits for what was typed: quick, at most a handful. `language`: "de-DE". */
  search: (query: string, language: string) => Promise<LookupHit[]>;
  /** A hit in full: its fields by name. */
  details: (id: string, language: string) => Promise<Record<string, LookupValue>>;
};

export const workspaceLookups = extensionPoint<LookupSource[]>("workspace.lookups");
