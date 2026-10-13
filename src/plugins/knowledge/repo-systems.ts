import { runAi } from "@/lib/ai";
import { errorMessage } from "@/lib/errors";
import { emitChange } from "@/lib/events";
import { listJiraBoards } from "@/lib/jira/store";
import { listRepos, type RepoView } from "@/lib/repos";
import { basisOf, getRepoSystems, setRepoSystems } from "./repo-systems-store";
import type { TodoLink } from "./shared";

const MAX_AGE_MS = 7 * 24 * 3600 * 1000;

const SCHEMA = {
  type: "object",
  properties: {
    systems: {
      type: "array",
      items: {
        type: "object",
        properties: { i: { type: "integer" }, env: { type: "string", enum: ["prod", "test", "dev"] }, label: { type: "string" } },
        required: ["i", "env", "label"],
      },
    },
  },
  required: ["systems"],
};
type Answer = { systems?: { i?: number; env?: string; label?: string }[] };

const INSTRUCTIONS = `Du ordnest einem Code-Repo die Adressen seiner laufenden Systeme zu (Produktion, Test/Staging/Integration, Entwicklung). Unten stehen das Repo (Name, GitLab-Projekt, Jira-Boards/Projekte) und Kandidaten [i] — Web-Adressen aus den Seiten der Wissensbasis, mit Beschriftung und Seitentitel. Wähle NUR die Adressen, unter denen die Anwendung dieses Repos selbst erreichbar ist (die Website/App, ihr Backend/CMS, ihre Test-/Staging-/Integrationsumgebung) — keine Dokumentation, keine Werkzeuge (GitLab, Jira, Wiki, Composer, Docker, PHP …), keine Fremdsysteme, keine Systeme eines anderen Projekts. Gib zu jeder gewählten Adresse die Umgebung: prod (Produktion/Live), test (Test, Staging, Stage, Integration, Abnahme) oder dev (Entwicklung, DDEV, lokal), und eine kurze Beschriftung (z. B. „Staging“, „Produktion“). Lieber eine Adresse weglassen als eine fremde nehmen; passt nichts, gib eine leere Liste.`;

/** What the knowledge is searched with for a repo: its name, GitLab project, boards (and their Jira projects) and tickets. */
function queryOf(r: RepoView): string {
  const boards = listJiraBoards().filter((b) => r.boards.includes(b.id));
  const words = [r.name, r.gitlabProject?.split("/").slice(-2).join(" "), ...boards.flatMap((b) => [b.name, b.projectKey ?? ""]), ...r.tickets.map((k) => k.split("-")[0])];
  return [...new Set(words.filter((w): w is string => !!w && w.trim().length > 1))].join(" ");
}

/** One repo's systems read from the knowledge by the AI (and stored); null when there's nothing to go by. */
async function readRepo(r: RepoView): Promise<TodoLink[] | null> {
  const { knowledgeLinks } = await import("./client");
  const query = queryOf(r);
  const ticket = r.tickets[0] ?? null;
  const links = (await knowledgeLinks(query, ticket, 80)).filter((l) => l.env !== "other" || l.label);
  if (!links.length) {
    setRepoSystems(r.id, { at: new Date().toISOString(), basis: basisOf(r), systems: [] });
    return [];
  }
  const boards = listJiraBoards().filter((b) => r.boards.includes(b.id));
  const head = [`Repo: ${r.name}`, r.gitlabProject ? `GitLab: ${r.gitlabProject}` : "", boards.length ? `Jira: ${boards.map((b) => `${b.name}${b.projectKey ? ` (${b.projectKey})` : ""}`).join(", ")}` : ""].filter(Boolean).join("\n");
  const list = links.map((l, i) => `[${i}] ${l.env === "other" ? "System" : l.env.toUpperCase()} ${l.label ? `„${l.label}“ ` : ""}${l.url} (Seite „${l.pageTitle}“)`).join("\n");
  const answer = await runAi<Answer>(`${INSTRUCTIONS}\n\n${head}\n\nKandidaten:\n${list}`, SCHEMA, { task: "knowledge-relations", timeoutMs: 5 * 60000, maxBudgetUsd: 0.3 });
  const picked = new Map<string, TodoLink>();
  for (const s of answer.output?.systems ?? []) {
    const l = links[Number(s.i)];
    if (!l || (s.env !== "prod" && s.env !== "test" && s.env !== "dev")) continue;
    picked.set(l.url, { env: s.env, label: (s.label ?? "").trim() || l.label, url: l.url, page: l.pageTitle });
  }
  const rank = { prod: 0, test: 1, dev: 2, other: 3 } as const;
  const systems = [...picked.values()].sort((a, b) => rank[a.env] - rank[b.env]);
  setRepoSystems(r.id, { at: new Date().toISOString(), basis: basisOf(r), systems });
  return systems;
}

/**
 * The systems of every configured repo (Prod, Test/Stage, Dev), read from the knowledge by the AI — once per repo, not per
 * todo: every todo whose ticket goes to the repo shows them. Read again when the repo's name/project/boards changed or
 * after a week; `force` reads all.
 */
export async function relateRepoSystems(force = false): Promise<{ repos: number; read: number; failed: number }> {
  const repos = listRepos();
  let read = 0;
  let failed = 0;
  for (const r of repos) {
    const have = getRepoSystems(r.id);
    if (!force && have && have.basis === basisOf(r) && Date.now() - Date.parse(have.at) < MAX_AGE_MS) continue;
    try {
      await readRepo(r);
      read++;
    } catch (e) {
      failed++;
      console.error("[knowledge-repo-systems]", r.name, errorMessage(e));
    }
  }
  if (read) emitChange("todos");
  return { repos: repos.length, read, failed };
}
