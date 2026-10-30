/**
 * What the "+" menu's "Automation …" makes (the Workspace plugin): an agent's or an automation's page (its routine's controls
 * first, then its instructions), the jobs for agents and the rules — features of their own, not templates. Server only.
 */
import { t } from "@/lib/i18n/server";
import { markdownToDoc } from "./doc";
import { createJobsDatabase } from "./jobs";
import { createRoutine } from "./routines";
import { createRulesDatabase } from "./rules";
import { createPage } from "./store";

export type AutomationKind = { key: string; name: string; icon: string; description: string };
type Maker = AutomationKind & { make: (parentId: number | null) => number };

/** A routine's page: its controls block first (run, when, what it may do …), then the blocks that are its instructions (or notes). */
function routinePage(kind: "agent" | "automation", parentId: number | null, title: string, icon: string, intro: string): number {
  const doc = { type: "doc", content: [{ type: "zeffRoutine" }, ...(markdownToDoc(intro).content ?? [])] };
  const id = createPage({ parentId, title, icon, content: doc });
  createRoutine(id, kind);
  return id;
}

const makers = (): Maker[] => [
  {
    key: "agent",
    name: t("Agent"),
    icon: "🤖",
    description: t("An LLM run on the instructions you write here — by hand, on a schedule or on an event; it knows its parent and sibling pages."),
    make: (parentId) => routinePage("agent", parentId, t("New agent"), "🤖", `${t("Write what the agent should do — one block per instruction.")}\n\n- ${t("Read the pages next to this one.")}\n- ${t("Write what you find as a short summary under this page.")}\n`),
  },
  {
    key: "automation",
    name: t("Automation"),
    icon: "⚙️",
    description: t("Steps that run one after another, with gates, branches and conditions — no AI; on a schedule, on an event or by hand."),
    make: (parentId) => routinePage("automation", parentId, t("New automation"), "⚙️", t("What this automation is for, in a line — its steps are above.")),
  },
  {
    key: "jobs",
    name: t("Jobs for agents"),
    icon: "🤖",
    description: t("Jobs a worker takes on your click — a board by status; the result comes back into the row for your check."),
    make: (parentId) => createJobsDatabase(parentId),
  },
  {
    key: "rules",
    name: t("Rules"),
    icon: "📏",
    description: t("When / then rules a pipeline applies to its records: drop, set a field, hand to an agent — or a hint every agent gets."),
    make: (parentId) => createRulesDatabase(parentId),
  },
];

/** What "Automation …" offers, in its order. */
export const AUTOMATION_KINDS = (): AutomationKind[] => makers().map(({ key, name, icon, description }) => ({ key, name, icon, description }));

/** One of them made under `parentId` (null: at the top). Returns its page. */
export function createAutomation(key: string, parentId: number | null): number {
  const m = makers().find((x) => x.key === key);
  if (!m) throw new Error(t("There is no such kind."));
  return m.make(parentId);
}
