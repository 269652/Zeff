"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { setPluginInstalledAction } from "@/app/actions";
import { useT } from "@/components/I18nProvider";
import { toast } from "./Toaster";

/** A tile: what you use, in your words — and the plugins that read it (installed together, taken off together). */
type Choice = { id: string; label: string; hint?: string; plugins: string[]; experimental?: boolean };
type Group = { title: string; choices: Choice[] };

/** The AI plugins that come along with any AI backend: the AI layer and the ready-made actions. */
const AI_BASE = ["llm", "auto-actions"];

const groups = (t: (s: string) => string): Group[] => [
  {
    title: t("Mail"),
    choices: [
      { id: "gmail", label: "Gmail", plugins: ["gmail"] },
      { id: "outlook", label: "Outlook", hint: t("Work or Microsoft 365"), plugins: ["outlook-mail"] },
      { id: "imap", label: t("Other mail"), hint: "T-Online, GMX, WEB.DE, iCloud …", plugins: ["imap-mail"] },
    ],
  },
  {
    title: t("Chats"),
    choices: [
      { id: "whatsapp", label: "WhatsApp", plugins: ["whatsapp"], experimental: true },
      { id: "signal", label: "Signal", plugins: ["signal"], experimental: true },
      { id: "teams", label: "Microsoft Teams", plugins: ["teams"] },
    ],
  },
  {
    title: t("Calendar"),
    choices: [
      { id: "gcal", label: "Google Calendar", plugins: ["google-calendar"] },
      { id: "ocal", label: t("Outlook calendar"), plugins: ["outlook-calendar"] },
    ],
  },
  {
    title: t("Work"),
    choices: [
      { id: "jira", label: "Jira", plugins: ["jira"] },
      { id: "gitlab", label: "GitLab", plugins: ["gitlab"] },
      { id: "time", label: t("Time tracking"), plugins: ["zeiterfassung"] },
    ],
  },
  {
    title: t("Life"),
    choices: [
      { id: "people", label: t("People & birthdays"), plugins: ["people"] },
      { id: "money", label: t("Letters, cases & money"), hint: t("File numbers, debts, bank statements"), plugins: ["cases", "finances"] },
      { id: "docs", label: t("Documents"), hint: t("PDFs, scans, letters"), plugins: ["documents"] },
      { id: "news", label: t("News"), plugins: ["news"] },
    ],
  },
  {
    title: t("The AI that reads it for you"),
    choices: [
      { id: "claude", label: "Claude", hint: t("Claude Code, with your Claude account"), plugins: [...AI_BASE, "claude-cli"] },
      { id: "chatgpt", label: "ChatGPT", hint: t("Codex, with your ChatGPT account"), plugins: [...AI_BASE, "codex-cli"] },
      { id: "copilot", label: "GitHub Copilot", hint: t("Copilot CLI, with your GitHub account"), plugins: [...AI_BASE, "copilot-cli"] },
      { id: "local", label: t("Local AI"), hint: t("Ollama or LM Studio — nothing leaves this computer"), plugins: [...AI_BASE, "local-ai"] },
    ],
  },
];

/**
 * The setup's first step: "What do you use?" — tiles for mail, chats, calendars, work and life, and the AI. A tile on
 * installs what reads it; off takes it away again (but what another chosen tile still needs). Everything else: the full
 * plugin list, a step further.
 */
export function SetupChoices({ installed }: { installed: string[] }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const on = new Set(installed);
  const all = groups(t);
  const chosen = (c: Choice) => c.plugins.every((p) => on.has(p));
  const toggle = (c: Choice) =>
    start(async () => {
      const turnOn = !chosen(c);
      // Off: only what no other chosen tile needs (two AIs share the AI layer).
      const still = new Set(all.flatMap((g) => g.choices).filter((x) => x.id !== c.id && chosen(x)).flatMap((x) => x.plugins));
      const ids = turnOn ? c.plugins.filter((p) => !on.has(p)) : c.plugins.filter((p) => !still.has(p));
      for (const id of ids) {
        const r = await setPluginInstalledAction(id, turnOn);
        if (!r?.ok) {
          toast(r?.error ?? t("Didn't work."), { tone: "error" });
          break;
        }
      }
      router.refresh();
    });
  return (
    <div className="space-y-5">
      {all.map((g) => (
        <section key={g.title} className="space-y-2">
          <h2 className="text-sm font-semibold text-zinc-500 uppercase">{g.title}</h2>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-2">
            {g.choices.map((c) => {
              const yes = chosen(c);
              return (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={yes}
                  disabled={pending}
                  onClick={() => toggle(c)}
                  className={`card flex flex-col items-start gap-0.5 p-3 text-left transition ${yes ? "border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500 dark:bg-indigo-950/40" : "hover:border-zinc-400"}`}
                >
                  <span className="flex w-full items-center gap-2 font-medium">
                    <span aria-hidden className={`grid size-4 place-items-center rounded border text-[10px] ${yes ? "border-indigo-600 bg-indigo-600 text-white" : "border-zinc-400"}`}>
                      {yes ? "✓" : ""}
                    </span>
                    {c.label}
                  </span>
                  {c.hint && <span className="text-xs text-zinc-600 dark:text-zinc-400">{c.hint}</span>}
                  {c.experimental && <span className="text-xs text-amber-800 dark:text-amber-300">{t("Experimental")}</span>}
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
