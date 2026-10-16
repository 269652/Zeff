import { getPref, setPref } from "@/lib/prefs";
import { t } from "@/lib/i18n/server";
import { systemPromptPages } from "@/lib/prompts";
import { docToMarkdown, markdownToDoc } from "./doc";
import { createPage, getPage, tree } from "./store";

/**
 * Instructions for the AI steps: pages of the Workspace under "KI-Anweisungen" — written and changed like any page, chosen
 * by an AI step (a field on each row, a summary) in the block editor; their text goes with its prompt as a part of the
 * instruction. A first one is made with the folder: "Lage" — the rules the Ticket-Lage reads a ticket by.
 */

const FOLDER = "workspace.instructionsFolder";

const LAGE = `Sprich mich mit „du“ an, schreib auf Deutsch, nüchtern und konkret: Daten, Namen, was offen ist — keine Floskeln, nichts erfinden, was nicht in den Daten steht.

Wie ein Ticket steht (attention): feedback = jemand wartet auf eine Antwort oder Nacharbeit von mir; active = ich arbeite daran; check = Testing/Review bei anderen; spec = Spezifikation/Klärung; blocked = wartet auf andere/extern; ready = bereit, nicht begonnen; stale = liegt seit Wochen ohne Bewegung.

Das Dringendste zuerst: eine offene Rückfrage an mich vor laufender Arbeit vor Wartendem vor Ungestartetem. Todos, die ich als WICHTIG markiert habe, sind dringend.

„MEINE NOTIZEN“ habe ich selbst geschrieben — sie gehen anderen Daten vor. Was dort als geprüft, geklärt oder erledigt steht, gilt fürs ganze Ticket.

Git ist der Beleg: steht ein Commit zum Ticket auf main oder ist sein Branch gemergt, ist die Änderung auf main.

Automatische Benachrichtigungen (Jira, GitLab, Systeme) wiederholen meist, was schon bekannt ist: nur, wenn sie etwas Neues sagen. Mit [erledigt] markierte Kommentare und Nachrichten habe ich abgehakt.`;

/** The page the instructions are under — made (with "Lage") when there's none. */
export function instructionsFolder(): number {
  const known = getPref<number | null>(FOLDER, null);
  const p = known ? getPage(known) : null;
  if (p && !p.archivedAt) return p.id;
  const id = createPage({ title: "KI-Anweisungen", icon: "🧠" });
  setPref(FOLDER, id);
  createPage({ title: "Lage", icon: "📋", parentId: id, content: markdownToDoc(LAGE) });
  return id;
}

/** The instructions there are: yours (the pages under the folder), then the system prompts (System → Prompts, by group). */
export function listInstructions(): { id: number; title: string; icon: string; group?: string }[] {
  const folder = instructionsFolder();
  const all = tree();
  const own = all.filter((p) => p.parentId === folder && p.kind !== "database").map((p) => ({ id: p.id, title: p.title || "Untitled", icon: p.icon }));
  const byId = new Map(all.map((p) => [p.id, p]));
  const system = systemPromptPages().flatMap((x) => {
    const p = byId.get(x.pageId);
    return p ? [{ id: p.id, title: p.title || "Untitled", icon: p.icon, group: t(x.group) }] : [];
  });
  return [...own, ...system];
}

/** A new instruction (an empty page under the folder). */
export const newInstruction = (title: string): number => createPage({ title, parentId: instructionsFolder() });

/** The instructions' text for a prompt: each with its title (gone ones left out). */
export function instructionText(ids: number[] | undefined): string {
  return (ids ?? [])
    .map((id) => getPage(id))
    .filter((p): p is NonNullable<typeof p> => !!p && !p.archivedAt)
    .map((p) => `### ${p.title || "Anweisung"}\n${docToMarkdown(p.content).trim()}`)
    .join("\n\n");
}
