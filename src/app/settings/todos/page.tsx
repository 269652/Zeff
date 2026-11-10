import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { SubmitButton } from "@/components/SubmitButton";
import { BoardSettingsForm } from "@/components/boards/BoardSettingsForm";
import { aiChoice } from "@/lib/ai";
import { AI_PROVIDER_INFO } from "@/lib/ai/shared";
import { getBoardSettings } from "@/lib/runs/store";
import { listJiraBoards } from "@/lib/jira/store";
import { t } from "@/lib/i18n/server";
import { AREAS, KNOWLEDGE_KINDS } from "@/lib/todo-display";
import { getTodoDisplayOff } from "@/lib/todo-display-store";
import { saveTodoDisplayFormAction } from "@/plugins/todos/server-actions";
import { isInstalled } from "@/plugins/state";
import { DEFAULT_PICK_PROMPT } from "@/plugins/knowledge/repo-prompt";
import { getPickPrompt } from "@/plugins/knowledge/repo-systems-store";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Todo settings") };
}

/** Settings → Todos: the briefing (which tickets, how often), what a todo shows under its text, and which kinds of knowledge are worth showing there. */
export default async function TodoSettingsPage() {
  await connection();
  const off = new Set(getTodoDisplayOff());
  const board = getBoardSettings();
  const ai = aiChoice();
  const repoPromptPage = isInstalled("knowledge") ? await (await import("@/lib/prompts")).promptHref("repo-pick") : null;
  const areas: Record<(typeof AREAS)[number], { label: string; hint: string }> = {
    context: { label: t("Context"), hint: t("The mails, messages, tickets and comments a todo comes from.") },
    actions: { label: t("Actions"), hint: t("The actions the auto-actions review proposes. Off: they stay hidden (actions you added yourself are always shown).") },
    knowledge: { label: t("Knowledge"), hint: t("What the knowledge base has on it. Needs the Knowledge plugin.") },
  };
  const kinds: Record<(typeof KNOWLEDGE_KINDS)[number], { label: string; hint: string }> = {
    confluence: { label: t("Confluence"), hint: t("Pages of the extranet: how a system works, who does what, the addresses.") },
    keep: { label: t("Keep notes"), hint: t("Your notes from Google Keep.") },
    fact: { label: t("Facts and notes"), hint: t("What Zeff learned about you and your work, and the notes on the Context page.") },
    doc: { label: t("Documents"), hint: t("The documents you added.") },
    todo: { label: t("Todos"), hint: t("Other todos — they are on the board already.") },
    jira: { label: t("Jira tickets"), hint: t("Tickets — a todo shows its own as context.") },
    mail: { label: t("Mails and messages"), hint: t("Mails, Teams and chat messages — context already.") },
    gitlab: { label: t("GitLab"), hint: t("Merge requests and their comments — context already.") },
    work: { label: t("Work records"), hint: t("Time entries, runs, recaps and weekly reports.") },
  };
  return (
    <div className="page">
      <div className="page-aside">
        <Link href="/settings" className="text-sm text-zinc-500 hover:underline">
          ← {t("Settings")}
        </Link>
        <h1 className="text-lg font-semibold">{t("Todo settings")}</h1>
        <p className="text-sm text-zinc-500">{t("What a todo shows under its text, and what is worth showing as knowledge.")}</p>
      </div>
      {/* The briefing: which tickets it goes through, how often it runs (was under General, /preferences#boards). */}
      <section id="boards" className="card scroll-mt-4 space-y-3 p-4">
        <div>
          <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("Todos (briefing)")}</h2>
          <p className="max-w-[75ch] text-sm text-zinc-500">{t("Which tickets the briefing goes through, and how often it runs by itself.")}</p>
        </div>
        <BoardSettingsForm
          jql={board.jql}
          autoMinutes={board.autoMinutes}
          boards={listJiraBoards()
            .filter((b) => b.enabled)
            .map((b) => b.name)}
          ai={`${AI_PROVIDER_INFO[ai.provider].label}${ai.model ? ` · ${ai.model}` : ""}`}
        />
      </section>
      {/* The Todos tab's badge is set with all the others under Settings → Badges (it was a section here: #badge). */}
      <p id="badge" className="scroll-mt-4 text-sm text-zinc-500">
        {t("Badge on the Todos tab")} →{" "}
        <Link href="/settings/badges#todos" className="text-indigo-600 hover:underline dark:text-indigo-400">
          {t("Settings → Badges and dots")}
        </Link>
      </p>
      <form action={saveTodoDisplayFormAction} className="space-y-4">
        <section className="card space-y-3 p-4">
          <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("Show on a todo")}</h2>
          {AREAS.map((a) => (
            <label key={a} className="flex items-start gap-2 text-sm">
              <input type="checkbox" name={`area:${a}`} defaultChecked={!off.has(`area:${a}`)} className="mt-1" disabled={a === "knowledge" && !isInstalled("knowledge")} />
              <span>
                <span className="font-medium">{areas[a].label}</span>
                <span className="block text-xs text-zinc-500">{areas[a].hint}</span>
              </span>
            </label>
          ))}
        </section>
        <section className="card space-y-3 p-4">
          <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("Merging")}</h2>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="mergeGate" defaultChecked={!off.has("mergeGate")} className="mt-1" />
            <span>
              <span className="font-medium">{t("Hold the Merge button until the merge request is approved")}</span>
              <span className="block text-xs text-zinc-500">{t("On: the button waits for the approval (the GitLab sync notices it). Off: it can be clicked at once; a merge request that is merged or closed already stays blocked.")}</span>
            </span>
          </label>
        </section>
        <section className="card space-y-3 p-4">
          <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("What counts as knowledge")}</h2>
          <p className="text-xs text-zinc-500">{t("Knowledge should be what Zeff learned or found out — not what a todo shows as context anyway. Unticked kinds are left out when the knowledge is assigned and are hidden in the todos right away; ticking one again picks it up with the next assignment.")}</p>
          {KNOWLEDGE_KINDS.map((k) => (
            <label key={k} className="flex items-start gap-2 text-sm">
              <input type="checkbox" name={`kind:${k}`} defaultChecked={!off.has(`kind:${k}`)} className="mt-1" />
              <span>
                <span className="font-medium">{kinds[k].label}</span>
                <span className="block text-xs text-zinc-500">{kinds[k].hint}</span>
              </span>
            </label>
          ))}
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="entities" defaultChecked={!off.has("entities")} className="mt-1" />
            <span>
              <span className="font-medium">{t("Concepts")}</span>
              <span className="block text-xs text-zinc-500">{t("Terms, systems and people the knowledge base explains (the small chips).")}</span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="links" defaultChecked={!off.has("links")} className="mt-1" />
            <span>
              <span className="font-medium">{t("System addresses")}</span>
              <span className="block text-xs text-zinc-500">{t("The Test, Stage and Prod addresses of the system a todo is about.")}</span>
            </span>
          </label>
        </section>
        {isInstalled("knowledge") && (
          <section className="card space-y-3 p-4">
            <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("Repo summaries")}</h2>
            <p className="text-xs text-zinc-500">
              {t("A todo shows what the knowledge says about its repo: the Prod, Test and Dev addresses and what the project is. First the AI reads the pages found about the repo and picks the addresses by these rules (German, like all Zeff prompts; the answer format and the pages are added automatically). A change takes effect with the next Knowledge relation, or “Read again” on the Repos page.")}
            </p>
            {repoPromptPage ? (
              <p className="text-sm">
                <span className="font-medium">{t("Rules for picking the addresses")}</span>{" "}
                <a href={repoPromptPage} className="text-indigo-600 hover:underline dark:text-indigo-400">
                  📝 {t("change them in the Workspace")}
                </a>
              </p>
            ) : (
              <>
                <label className="block text-sm">
                  <span className="font-medium">{t("Rules for picking the addresses")}</span>
                  <textarea name="repoPrompt" defaultValue={getPickPrompt() || DEFAULT_PICK_PROMPT} rows={14} spellCheck={false} className="input mt-1 w-full font-mono text-xs" />
                </label>
                <button type="submit" name="resetRepoPrompt" value="1" className="btn" disabled={!getPickPrompt()}>
                  {t("Restore the built-in rules")}
                </button>
              </>
            )}
          </section>
        )}
        <SubmitButton className="btn btn-primary">{t("Save")}</SubmitButton>
      </form>
    </div>
  );
}
