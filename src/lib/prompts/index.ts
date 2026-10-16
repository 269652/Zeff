import { getSqlite } from "@/db";
import { getPref, setPref } from "@/lib/prefs";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import { docToMarkdown, markdownToDoc, type DocNode } from "@/plugins/workspace/doc";
import { PROMPTS, PROMPT_GROUPS, type PromptEntry } from "./catalog";
import { addSystemPage, isSystemPage } from "./system-pages";

/**
 * The prompts as pages of the Workspace (System → Prompts → group → prompt). The code reads a prompt with promptText(key,
 * its built-in text): the page's text when it was changed, else the built-in text exactly (a page as it was written follows
 * the code's text when that changes). A page is made once per prompt (its plugin installed); what the settings had for it
 * goes in then. Back to the built-in text with resetSystemPrompt.
 */

export { isSystemPage } from "./system-pages";
export { PROMPTS, PROMPT_GROUPS } from "./catalog";

const PAGES = "system.prompts";
/** What each page got when it was written: its text (as the page keeps it), and what besides the built-in text went in. */
const WRITTEN = "system.promptsWritten";
const ROOT = "system.root";
const FOLDER = "system.promptsFolder";
const GROUPS = "system.promptGroups";
/** The steps whose own instructions are in their page now (not added on top any more). */
const FOLDED = "system.foldedSteps";

type Written = { text: string; setting?: string; extra?: string };

const pages = () => getPref<Record<string, number>>(PAGES, {});
const written = () => getPref<Record<string, Written>>(WRITTEN, {});

/** A text as a page keeps it (what Markdown comes back from it). */
const asKept = (text: string) => docToMarkdown(markdownToDoc(text)).trim();

const STEP_HEADING = "## Meine Anweisungen für diesen Schritt";
const withExtra = (text: string, extra?: string) => (extra?.trim() ? `${text}\n\n${STEP_HEADING}\n${extra.trim()}` : text);

/** A page's text (null: no page, or it's gone). */
function pageText(id: number | undefined): string | null {
  if (!id) return null;
  const r = getSqlite().prepare("select content, archived_at from ws_pages where id = ?").get(id) as { content: string; archived_at: string | null } | undefined;
  if (!r || r.archived_at) return null;
  try {
    return docToMarkdown(JSON.parse(r.content) as DocNode).trim();
  } catch {
    return null;
  }
}

/**
 * A prompt as the code uses it: its page's text when changed by hand; as written (untouched): the built-in text — with what
 * went in besides (a step's own instructions, the settings' text). No page: `before` (what the code used so far).
 */
export function promptText(key: string, builtIn: string, before: string = builtIn): string {
  const text = pageText(pages()[key]);
  if (text === null) return before;
  const w = written()[key];
  if (w && text === w.text) return w.setting ?? withExtra(builtIn, w.extra);
  if (!text) return builtIn;
  return text;
}

/** Whether a step's own instructions are in its prompt's page now (so not added on top). */
export const stepFolded = (step: string): boolean => getPref<string[]>(FOLDED, []).includes(step);

export type SystemPrompt = { key: string; group: string; title: string; uses: string; pageId: number | null; modified: boolean };

/** The prompts there are (their plugin installed), each with its page and whether it differs from the built-in text. */
export async function systemPrompts(): Promise<SystemPrompt[]> {
  const ids = pages();
  const out: SystemPrompt[] = [];
  for (const e of PROMPTS.filter(installed)) {
    const text = pageText(ids[e.key]);
    out.push({ key: e.key, group: e.group, title: e.title, uses: e.uses, pageId: text === null ? null : ids[e.key], modified: text !== null && text !== asKept(await e.builtIn()) });
  }
  return out;
}

const installed = (e: PromptEntry) => !e.plugin || isInstalled(e.plugin);

/** The page a system folder is kept as (made once; pref `key`, or by name in a map). */
async function folder(title: string, icon: string, parentId: number | null, get: () => number | undefined, set: (id: number) => void): Promise<number> {
  const { createPage, getPage } = await import("@/plugins/workspace/store");
  const known = get();
  if (known && getPage(known) && !getPage(known)!.archivedAt) return known;
  const id = createPage({ title, icon, parentId });
  set(id);
  addSystemPage(id);
  return id;
}

/**
 * System → Prompts with a page for each prompt (once — what the settings had goes in); an untouched page follows the built-in
 * text when the code's changes. Every account's Workspace has them.
 */
export async function ensureSystemPrompts(): Promise<void> {
  if (!isInstalled("workspace")) return;
  const { createPage, updatePage } = await import("@/plugins/workspace/store");
  const { getContextPrefs } = await import("@/lib/boards/context-prefs");
  const root = await folder(t("System"), "🛠", null, () => getPref<number | null>(ROOT, null) ?? undefined, (id) => setPref(ROOT, id));
  const top = await folder("Prompts", "💬", root, () => getPref<number | null>(FOLDER, null) ?? undefined, (id) => setPref(FOLDER, id));
  for (const g of PROMPT_GROUPS) {
    const entries = PROMPTS.filter((e) => e.group === g && installed(e));
    if (!entries.length) continue;
    const parent = await folder(t(g), "📁", top, () => getPref<Record<string, number>>(GROUPS, {})[g], (id) => setPref(GROUPS, { ...getPref<Record<string, number>>(GROUPS, {}), [g]: id }));
    for (const e of entries) {
      const builtIn = await e.builtIn();
      const id = pages()[e.key];
      const cur = pageText(id);
      if (cur === null) {
        // Made: with what the settings had (instead), or the built-in text with the step's own instructions below it.
        const setting = (await e.setting?.())?.trim() || undefined;
        const extra = e.step ? getContextPrefs()[e.step].extra.trim() || undefined : undefined;
        const text = setting ?? withExtra(builtIn, extra);
        const pageId = createPage({ title: t(e.title), icon: "📝", parentId: parent, content: markdownToDoc(text) });
        addSystemPage(pageId);
        setPref(PAGES, { ...pages(), [e.key]: pageId });
        setPref(WRITTEN, { ...written(), [e.key]: { text: pageText(pageId) ?? "", ...(setting ? { setting } : {}), ...(extra ? { extra } : {}) } });
        if (e.step) setPref(FOLDED, [...new Set([...getPref<string[]>(FOLDED, []), e.step])]);
        continue;
      }
      // Untouched, and the code's text changed: the page follows.
      const w = written()[e.key];
      if (w && cur === w.text && !w.setting) {
        const next = withExtra(builtIn, w.extra);
        if (asKept(next) !== cur) {
          updatePage(id, { content: markdownToDoc(next) });
          setPref(WRITTEN, { ...written(), [e.key]: { ...w, text: pageText(id) ?? "" } });
        }
      }
    }
  }
}

/** A prompt's page back to the built-in text (what went in besides too: gone). */
export async function resetSystemPrompt(pageId: number): Promise<void> {
  const key = Object.entries(pages()).find(([, id]) => id === pageId)?.[0];
  const e = PROMPTS.find((x) => x.key === key);
  if (!key || !e) throw new Error("Not a system prompt.");
  const { updatePage } = await import("@/plugins/workspace/store");
  updatePage(pageId, { content: markdownToDoc(await e.builtIn()) });
  setPref(WRITTEN, { ...written(), [key]: { text: pageText(pageId) ?? "" } });
}

/** The prompt a page is (null: none). */
export async function systemPromptOf(pageId: number): Promise<SystemPrompt | null> {
  if (!isSystemPage(pageId)) return null;
  return (await systemPrompts()).find((x) => x.pageId === pageId) ?? null;
}

/** Where a prompt is changed (its page, made if not yet) — null: no Workspace, or not a prompt of an installed plugin. */
export async function promptHref(key: string): Promise<string | null> {
  await ensureSystemPrompts();
  const id = pageText(pages()[key]) === null ? null : pages()[key];
  return id ? `/workspace/${id}` : null;
}
