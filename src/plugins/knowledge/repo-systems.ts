import { aiChoice, runAi } from "@/lib/ai";
import { promptText } from "@/lib/prompts";
import { errorMessage } from "@/lib/errors";
import { emitChange } from "@/lib/events";
import { getLanguage, t } from "@/lib/i18n/server";
import { listJiraBoards } from "@/lib/jira/store";
import { listRepos, type RepoView } from "@/lib/repos";
import { COPILOT_MAX_PROMPT } from "@/plugins/copilot-cli/cli";
import { DEFAULT_PICK_PROMPT } from "./repo-prompt";
import { fitSources, PICK_SCHEMA, systemsTable, verifyPicks } from "./repo-picks";
import { basisOf, getPickPrompt, getRepoSystems, setRepoSystems, type RepoPick } from "./repo-systems-store";

const MAX_AGE_MS = 7 * 24 * 3600 * 1000;

const SUMMARY_SCHEMA = { type: "object", properties: { intro: { type: "string" }, notes: { type: "string" } }, required: ["intro", "notes"] };
type SummaryAnswer = { intro?: string; notes?: string };

const LANGUAGE_NAMES = { de: "Deutsch", en: "Englisch", es: "Spanisch" } as const;

/** The second stage: the words around the table of systems (which the first stage picked and the code sets). */
export const SUMMARY_INSTRUCTIONS = `Du schreibst für ein Projekt (ein Code-Repo samt Jira-Projekten) eine knappe Beschreibung aus Auszügen der Wissensbasis. Wer an einem Ticket dieses Projekts arbeitet, sieht sie neben seinem Todo: sie soll ihm sagen, was das Projekt ist. Die Tabelle seiner Systeme (Prod, Test, Dev) wird getrennt eingefügt — wiederhole sie nicht.

Antworte mit:
- "intro": ein bis zwei Sätze, was das Projekt ist (Kunde/Produkt, Technik) — nur was die Quellen sagen.
- "notes": optional ein paar Markdown-Stichpunkte mit Wichtigem für die Arbeit (Zugänge — nie Passwörter oder Tokens —, Besonderheiten, Ansprechpartner), nur wenn die Quellen es hergeben; sonst ein leerer Text.
Erfinde nichts. Gehört eine Seite zu einem anderen Projekt (siehe die anderen Projekte unten), lass sie weg.`;

/** What the knowledge is searched with for a repo: one term each for its name, GitLab project, boards and Jira projects. */
function termsOf(r: RepoView): string[] {
  const boards = listJiraBoards().filter((b) => r.boards.includes(b.id));
  const words = [r.name, r.gitlabProject?.split("/").slice(-2).join(" "), ...boards.flatMap((b) => [b.name, b.projectKey ?? ""]), ...r.tickets.map((k) => k.split("-")[0])];
  return [...new Set(words.filter((w): w is string => !!w && w.trim().length > 1).map((w) => w.trim()))].slice(0, 12);
}

/** A repo for the prompt: its name, GitLab project, Jira boards/projects. */
function identityOf(r: RepoView): string {
  const boards = listJiraBoards().filter((b) => r.boards.includes(b.id));
  return [r.name, r.gitlabProject ? `GitLab ${r.gitlabProject}` : "", boards.length ? `Jira ${boards.map((b) => `${b.name}${b.projectKey ? ` (${b.projectKey})` : ""}`).join(", ")}` : "", r.tickets.length ? `Tickets ${r.tickets.join(", ")}` : ""].filter(Boolean).join(" · ");
}

/** The knowledge's pages for a repo, as the picking stage reads them (see repo-picks.ts). */
type Source = { id: string; title: string; space: string; url: string; summary: string | null; lines: string[] };

/** The prompt budget: Copilot takes its prompt on stdin like the others, but keeps to the same shorter limit as the reviews. */
const budgetOf = () => (aiChoice().provider === "copilot" || aiChoice().provider === "local" ? COPILOT_MAX_PROMPT : 3 * COPILOT_MAX_PROMPT) - 9000;

/** What the AI is told about the project and its neighbours (the same in both stages). */
const headOf = (r: RepoView, repos: RepoView[]): string =>
  [`Projekt: ${identityOf(r)}`, `Andere Projekte (nicht hierher gehörig): ${repos.filter((o) => o.id !== r.id).map(identityOf).join(" | ") || "(keine)"}`].join("\n");

/**
 * Stage 1 — the knowledge's pages about the repo go through the AI, which picks the addresses of its systems (your rules from
 * Settings → Todos, else the built-in ones). Only addresses that stand word for word in the pages are kept.
 */
export async function pickSystems(r: RepoView, repos: RepoView[], pages: Source[], rules = promptText("repo-pick", DEFAULT_PICK_PROMPT, getPickPrompt() || DEFAULT_PICK_PROMPT)): Promise<RepoPick[]> {
  const head = headOf(r, repos);
  const sources = fitSources(head, pages, budgetOf(), 40);
  if (!sources.length) return [];
  const prompt = `${rules}\n\n${head}\n\nQuellen:\n${sources.join("\n\n")}`;
  const answer = await runAi<{ systems?: unknown }>(prompt, PICK_SCHEMA, { task: "knowledge-relations", timeoutMs: 5 * 60000, maxBudgetUsd: 0.3 });
  if (!answer.output) throw new Error("no answer");
  return verifyPicks(answer.output, pages);
}

/** Stage 2 — what the project is, in a sentence or two, and a few notes (the AI); the table of the picked systems is set by the code. */
async function writeSummary(r: RepoView, repos: RepoView[], pages: Source[], picks: RepoPick[]): Promise<string> {
  let words: SummaryAnswer = {};
  try {
    const head = headOf(r, repos);
    const found = picks.length ? `Gefundene Systeme (stehen schon in der Tabelle):\n${picks.map((p) => `- ${p.env}: ${p.label} ${p.url}`).join("\n")}\n\n` : "";
    const prompt = `${promptText("repo-summary", SUMMARY_INSTRUCTIONS)}\n\nSchreib auf ${LANGUAGE_NAMES[getLanguage()]}.\n\n${head}\n\n${found}Quellen:\n${fitSources(head + found, pages, budgetOf(), 6).join("\n\n")}`;
    const answer = await runAi<SummaryAnswer>(prompt, SUMMARY_SCHEMA, { task: "knowledge-relations", timeoutMs: 5 * 60000, maxBudgetUsd: 0.3 });
    words = answer.output ?? {};
  } catch (e) {
    // The picked systems are the point — they stay even when the words around them can't be written.
    console.error("[knowledge-repo-systems] summary text", r.name, errorMessage(e));
  }
  const table = systemsTable(picks, { env: t("Environment"), system: t("System"), address: t("Address") }, { prod: t("Prod"), test: t("Test / Stage"), dev: t("Dev"), other: t("Other") });
  return [words.intro?.trim(), table, words.notes?.trim()].filter(Boolean).join("\n\n");
}

/**
 * One repo's summary written from the knowledge, nothing stored: the systems picked by the AI, then the words around them.
 * `trust`: the picks checked against what holds before they go into the summary (see repo-trust.ts).
 */
export async function composeRepo(r: RepoView, repos: RepoView[], rules?: string, trust?: (picks: RepoPick[]) => RepoPick[]): Promise<{ summary: string; systems: RepoPick[]; pages: number }> {
  const { knowledgeRepoSources } = await import("./client");
  const pages = await knowledgeRepoSources(termsOf(r), 16);
  if (!pages.length) return { summary: "", systems: [], pages: 0 };
  const picked = await pickSystems(r, repos, pages, rules);
  const systems = trust ? trust(picked) : picked;
  return { summary: await writeSummary(r, repos, pages, systems), systems, pages: pages.length };
}

/** One repo's summary written from the knowledge and stored — with the addresses that hold (a changed prod address waits for you). */
async function readRepo(r: RepoView, repos: RepoView[]): Promise<void> {
  const { trustPicks } = await import("./repo-trust");
  const { summary, systems } = await composeRepo(r, repos, undefined, (picks) => trustPicks(r.id, r.name, picks));
  setRepoSystems(r.id, { at: new Date().toISOString(), basis: basisOf(r, repos), summary, systems });
}

/**
 * The summary of every configured repo (what it is, its deployments with their links), written from the knowledge by the AI —
 * once per repo, not per todo: every todo whose ticket goes to the repo shows it. Written again when the repos changed or
 * after a week; `force` writes all.
 */
export async function relateRepoSystems(force = false): Promise<{ repos: number; read: number; failed: number }> {
  const repos = listRepos();
  let read = 0;
  let failed = 0;
  for (const r of repos) {
    const have = getRepoSystems(r.id);
    if (!force && have && have.summary !== undefined && have.basis === basisOf(r, repos) && Date.now() - Date.parse(have.at) < MAX_AGE_MS) continue;
    try {
      await readRepo(r, repos);
      read++;
    } catch (e) {
      failed++;
      console.error("[knowledge-repo-systems]", r.name, errorMessage(e));
    }
  }
  if (read) emitChange("todos");
  return { repos: repos.length, read, failed };
}
