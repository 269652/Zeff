/**
 * Everything about a ticket for a coding agent in its repo (the MCP tool ticket_brief): found by the ticket's key, a branch
 * name, or the repo folder it works in (its checked-out branch names the ticket) — the ticket (status, who has it, its
 * description and acceptance criteria), who asked for it and in what words, what was said about it lately (people, open
 * loops, chats — the know brief, when that plugin is on), its merge requests and branches, its open todos. Read only.
 * Server only.
 */
import { execFileSync } from "node:child_process";
import { getSqlite } from "@/db";

const KEY = /\b([A-Z][A-Z0-9]+-\d+)\b/;

/** The ticket a key, a branch name ("feature/PROJ-371-teaser") or a repo folder (its checked-out branch) names; null: none. */
export function ticketFrom(v: { ticket?: string; branch?: string; cwd?: string }): { key: string; via: string } | null {
  const fromText = (s?: string) => (s ? KEY.exec(s.toUpperCase())?.[1] ?? null : null);
  const direct = fromText(v.ticket);
  if (direct) return { key: direct, via: "ticket" };
  const byBranch = fromText(v.branch);
  if (byBranch) return { key: byBranch, via: `branch ${v.branch}` };
  if (v.cwd) {
    try {
      const branch = execFileSync("git", ["-C", v.cwd, "rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] }).trim();
      const key = fromText(branch);
      if (key) return { key, via: `branch ${branch} in ${v.cwd}` };
    } catch {
      // not a git folder
    }
  }
  return null;
}

/** The acceptance criteria a description spells out (a heading "Akzeptanzkriterien" / "Acceptance criteria" and what follows). */
export function acceptanceCriteria(description: string): string[] {
  const lines = String(description ?? "").split(/\r?\n/);
  const at = lines.findIndex((l) => /akzeptanzkriteri|acceptance criteri|definition of done|\bAK\b:?\s*$/i.test(l));
  if (at < 0) return [];
  const out: string[] = [];
  for (const l of lines.slice(at + 1)) {
    const v = l.trim();
    if (!v) {
      if (out.length) break;
      continue;
    }
    // The next heading ends them (Jira's "h2.", Markdown's "## " — a single "# " is Jira's numbered list, an item).
    if (/^(h\d\.\s|#{2,6}\s|\*[^*]+\*\s*$)/.test(v) && out.length) break;
    out.push(v.replace(/^[-*#•]\s*|^\d+[.)]\s*/, ""));
    if (out.length >= 15) break;
  }
  return out;
}

const clip = (s: string, n: number) => {
  const v = String(s ?? "").replace(/\s+/g, " ").trim();
  return v.length > n ? `${v.slice(0, n - 1)}…` : v;
};

/** The brief as Markdown; null when the ticket isn't known to Zeff. */
export async function ticketBrief(key: string): Promise<string | null> {
  const db = getSqlite();
  const t = db.prepare("select key, summary, description, status, assignee, url, issue_type, priority from jira_tickets where key = ?").get(key) as
    | { key: string; summary: string; description: string | null; status: string; assignee: string | null; url: string | null; issue_type: string | null; priority: string | null }
    | undefined;
  const { listTodos } = await import("@/lib/boards/store");
  const todos = listTodos({ ticket: key, status: "all" });
  if (!t && !todos.length) return null;
  const out: string[] = [`# ${key}${t ? ` — ${t.summary}` : ""}`];
  if (t) {
    out.push("", `Status: ${t.status} · assigned to ${t.assignee ?? "nobody"}${t.issue_type ? ` · ${t.issue_type}` : ""}${t.priority ? ` · ${t.priority}` : ""}${t.url ? ` · ${t.url}` : ""}`);
    const ac = acceptanceCriteria(t.description ?? "");
    if (ac.length) out.push("", "## Acceptance criteria", ...ac.map((a) => `- ${a}`));
    if (t.description?.trim()) out.push("", "## Description", clip(t.description, 3000));
  }

  // Who asked, in their words: the messages the ticket's todos were made from (up their chain).
  const { requesterOf } = await import("@/lib/boards/requester");
  const asked = new Map<string, string>();
  for (const td of todos) {
    const r = await requesterOf(td);
    if (!r || asked.has(r.ref)) continue;
    const key2 = r.ref.slice(r.ref.indexOf(":") + 1);
    const m = r.channel === "teams"
      ? (db.prepare("select sent_at at, text from teams_messages where key = ?").get(key2) as { at: string; text: string } | undefined)
      : (db.prepare("select received_at at, preview text from emails where key = ?").get(key2) as { at: string; text: string } | undefined);
    asked.set(r.ref, `- ${r.who} (${r.channel}${m ? `, ${m.at.slice(0, 16).replace("T", " ")}` : ""}): ${m ? `“${clip(m.text, 300)}”` : ""}`);
  }
  if (asked.size) out.push("", "## Who asked for it", ...asked.values());

  // What was said about it lately: chats naming it (newest first).
  const chats = db.prepare("select sender_name, sent_at, text from teams_messages where text like ? order by sent_at desc limit 8").all(`%${key}%`) as { sender_name: string | null; sent_at: string; text: string }[];
  if (chats.length) out.push("", "## Teams lately", ...chats.map((c) => `- ${c.sent_at.slice(0, 16).replace("T", " ")} ${c.sender_name ?? "?"}: ${clip(c.text, 240)}`));

  // Its merge requests and branches.
  const mrs = db.prepare("select kind, title, state, url, branch, updated_at from gitlab_items where (title like ? or branch like ?) and kind in ('mr', 'branch') order by updated_at desc limit 8").all(`%${key}%`, `%${key}%`) as { kind: string; title: string; state: string | null; url: string | null; branch: string | null; updated_at: string }[];
  if (mrs.length) out.push("", "## Merge requests and branches", ...mrs.map((m) => `- ${m.kind === "mr" ? "MR" : "branch"} ${m.branch ?? ""} — ${clip(m.title, 120)}${m.state ? ` (${m.state})` : ""}${m.url ? ` ${m.url}` : ""}`));

  // People, open loops, what happened (the know brief), when that plugin is on.
  try {
    const { isInstalled } = await import("@/plugins/state");
    if (isInstalled("know")) {
      const { briefFor, briefText } = await import("@/plugins/know/brief");
      const text = briefText(await briefFor([`ticket:${key}`]));
      if (text.trim()) out.push("", "## Around it (people, open loops, latest)", text.trim());
    }
  } catch {
    // without it
  }

  const open = todos.filter((x) => x.status === "open");
  if (open.length) out.push("", "## Open todos", ...open.map((x) => `- ${x.ref} (${x.kind}${x.owner === "other" ? ", waiting for others" : ""}): ${clip(x.text, 200)}`));
  const done = todos.filter((x) => x.status !== "open").slice(-6);
  if (done.length) out.push("", "## Done or dropped lately", ...done.map((x) => `- ${x.ref} ${x.status}: ${clip(x.text, 160)}`));
  out.push("", "(For one todo's full brief — its sources in full, earlier runs — use todo_context with its T-id.)");
  if (open.length) {
    const { CLOCK_RULE } = await import("./todo-clock");
    out.push("", CLOCK_RULE);
  }
  return out.join("\n");
}
