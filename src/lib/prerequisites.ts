import { findBrowser } from "../../scripts/browser-find.mjs";
import { gitPath } from "@/lib/git";
import { t } from "@/lib/i18n/server";
import { getJiraSyncConfig } from "@/lib/jira/sync";
import { findUvx, installCommand, relevantRows, type PrereqId } from "@/lib/prerequisites-shared";
import { findClaudeCli } from "@/plugins/claude-cli/cli";
import { findCodexCli } from "@/plugins/codex-cli/cli";
import { findCopilotCli } from "@/plugins/copilot-cli/cli";
import { findPoppler, manualInstall } from "@/plugins/documents/poppler";
import { installedPlugins } from "@/plugins/state";
import path from "node:path";

/**
 * What a release bundle does NOT bring and a PC may lack — one list for the Setup and Plugins pages.
 * The bundle has Node, the servers, the drivers and every library; these are programs of the PC:
 * the automation browser (Chrome, or Edge — in every Windows 10/11), git, uv (Jira), the AI CLIs, Poppler.
 * Server only.
 */
export type Prerequisite = {
  id: PrereqId;
  label: string;
  /** What breaks without it. */
  neededFor: string;
  /** Where it was found (null: not on this PC). */
  found: string | null;
  /** The one-line way to get it. */
  howToGet: string;
};

/** Every program, found or not — whatever plugins are installed. */
export function prerequisites(): Prerequisite[] {
  const browser = findBrowser();
  const uvx = findUvx();
  const poppler = findPoppler();
  const codex = findCodexCli();
  const copilot = findCopilotCli();
  return [
    {
      id: "browser",
      label: t("Automation browser"),
      neededFor: t("The sign-ins and syncs that read websites (Outlook, Teams, GitLab, Chrono, Punch, Gmail, WhatsApp, Keep)"),
      found: browser ? `${browser.name === "CHROME_PATH" ? "" : `${browser.name} — `}${browser.path}` : null,
      howToGet: t("Install Google Chrome — or use Microsoft Edge, which Windows 10/11 has already. CHROME_PATH names another Chromium browser."),
    },
    {
      id: "git",
      label: "Git",
      neededFor: t("The Code tab (worktrees, diffs, commits) and the repos"),
      found: gitPath(),
      howToGet: t("Install Git: {command}", { command: installCommand("git") }),
    },
    {
      id: "uv",
      label: "uv (uvx)",
      neededFor: t("The Jira sync — it starts the Jira MCP server (mcp-atlassian) with uvx; first start downloads it"),
      found: uvx,
      howToGet: t("Install uv: {command} — or point JIRA_MCP_COMMAND at another Jira MCP server", { command: installCommand("uv") }),
    },
    {
      id: "claude",
      label: t("Claude CLI"),
      neededFor: t("AI answers and Code sessions with Claude"),
      found: findClaudeCli(),
      howToGet: t("Install Claude Code (https://claude.com/claude-code), then sign in once with “claude”. CLAUDE_CLI names its program."),
    },
    {
      id: "codex",
      label: t("Codex CLI"),
      neededFor: t("AI answers and Code sessions with ChatGPT"),
      found: codex?.where ?? null,
      howToGet: t("Install it with Node.js: npm install -g @openai/codex — then “codex login” once. CODEX_CLI names its program."),
    },
    {
      id: "copilot",
      label: t("Copilot CLI"),
      neededFor: t("AI answers and Code sessions with GitHub Copilot"),
      found: copilot?.where ?? null,
      howToGet: t("Install it with Node.js: npm install -g @github/copilot — then “/login” in copilot once. COPILOT_CLI names its program."),
    },
    {
      id: "poppler",
      label: "Poppler (pdftoppm)",
      neededFor: t("Reading scanned or complex PDFs (Documents); Zeff installs it by itself where winget or Homebrew is there"),
      found: poppler ? path.join(poppler, process.platform === "win32" ? "pdftoppm.exe" : "pdftoppm") : null,
      howToGet: t("Install Poppler: {command}", { command: manualInstall() }),
    },
  ];
}

/** The rows the installed plugins need (the Setup and Plugins pages show only these). */
export function neededPrerequisites(): Prerequisite[] {
  let jiraCommand: string | null = null;
  try {
    jiraCommand = getJiraSyncConfig().command ?? null;
  } catch {
    // no config: the default (uvx)
  }
  return relevantRows(prerequisites(), installedPlugins(), { jiraCommand });
}
