/**
 * Branch rules: what colleagues said about naming branches ("the branch names the code change, not the
 * ticket's title"), kept as knowledge artifacts — the rule in a sentence, the message it comes from linked and
 * quoted, tags (branch-naming, convention, the project) — so they stay when the message is gone from the sync or
 * the context. A rule applies to all tickets or to one project (the key's prefix). Workers get the rules that
 * apply when they name a branch (see branch-naming.ts); the knowledge server gets them as pages. Server only.
 */
import { getSqlite } from "@/db";
import { BRANCH_TAG, readSource, type Source } from "./branch-knowledge";

export const RULE_TAG = "convention";

export type BranchRule = { id: number; title: string; text: string; /** "*" (all) or a project key like "PROJ". */ scope: string; enabled: boolean; sources: Source[]; tags: string[]; createdAt: string };
type Row = { id: number; title: string; text: string; scope: string; enabled: number; sources: string; created_at: string };

function db() {
  const d = getSqlite();
  d.exec("create table if not exists branch_rules (id integer primary key autoincrement, title text not null, text text not null, scope text not null default '*', enabled integer not null default 1, sources text not null default '[]', created_at text not null)");
  return d;
}

const toRule = (r: Row): BranchRule => ({
  id: r.id,
  title: r.title,
  text: r.text,
  scope: r.scope,
  enabled: !!r.enabled,
  sources: (() => {
    try {
      return JSON.parse(r.sources) as Source[];
    } catch {
      return [];
    }
  })(),
  tags: [BRANCH_TAG, RULE_TAG, ...(r.scope === "*" ? [] : [r.scope])],
  createdAt: r.created_at,
});

export const listBranchRules = (): BranchRule[] => (db().prepare("select * from branch_rules order by id").all() as Row[]).map(toRule);

/** The rules that apply to a ticket's branch: the enabled ones for all tickets and for its project. */
export function rulesFor(ticket: string): BranchRule[] {
  const project = ticket.trim().toUpperCase().split("-")[0];
  return listBranchRules().filter((r) => r.enabled && (r.scope === "*" || r.scope.toUpperCase() === project));
}

/**
 * A rule kept: its sentence, and the messages it comes from (refs: teams:<key>, jira-comment:<id>, mail:<key>) — read
 * and kept as they are now. Not the same sentence twice.
 */
export function addBranchRule(v: { text: string; title?: string; scope?: string; refs?: string[] }): number | null {
  const text = v.text.trim().slice(0, 600);
  if (!text) throw new Error("A rule needs its sentence.");
  const d = db();
  if (listBranchRules().some((r) => r.text.toLowerCase() === text.toLowerCase())) return null;
  const sources = (v.refs ?? []).flatMap((ref) => {
    const s = readSource(ref.trim());
    return s ? [s] : [];
  });
  const scope = /^[A-Za-z][A-Za-z0-9]+$/.test(v.scope?.trim() ?? "") ? v.scope!.trim().toUpperCase() : "*";
  const r = d.prepare("insert into branch_rules (title, text, scope, sources, created_at) values (?, ?, ?, ?, ?)").run((v.title?.trim() || text.slice(0, 80)).slice(0, 120), text, scope, JSON.stringify(sources), new Date().toISOString());
  return Number(r.lastInsertRowid);
}

export const setBranchRuleEnabled = (id: number, enabled: boolean) => void db().prepare("update branch_rules set enabled = ? where id = ?").run(enabled ? 1 : 0, id);
export const deleteBranchRule = (id: number) => void db().prepare("delete from branch_rules where id = ?").run(id);

/** Words that make a message about branches an instruction (what to do or not do), not just talk about one. */
const CUE = /\b(nicht|bitte|lieber|achten|zu lang|kurz|shorten|benenn|namen|name|statt|besser|sollte|soll|wollen|haben wir)\b/i;

/**
 * Messages that read like an instruction about naming branches — from Teams and Jira, newest first — that no
 * rule cites yet: for you to look at and keep as a rule.
 */
export function suggestRuleMessages(limit = 12): Source[] {
  const d = getSqlite();
  const used = new Set(listBranchRules().flatMap((r) => r.sources.map((s) => s.ref)));
  const out: Source[] = [];
  const all = <T>(sql: string, ...a: unknown[]) => {
    try {
      return d.prepare(sql).all(...a) as T[];
    } catch {
      return [];
    }
  };
  const since = new Date(Date.now() - 200 * 864e5).toISOString();
  for (const m of all<{ key: string }>("select key from teams_messages where sent_at > ? and text like '%branch%' order by sent_at desc limit 200", since)) {
    const s = readSource(`teams:${m.key}`);
    if (s && CUE.test(s.text) && !used.has(s.ref) && /branch/i.test(s.text)) out.push(s);
  }
  for (const c of all<{ id: string }>("select id from jira_comments where at > ? and body like '%branch%' order by at desc limit 100", since)) {
    const s = readSource(`jira-comment:${c.id}`);
    if (s && CUE.test(s.text) && !used.has(s.ref) && /branch/i.test(s.text)) out.push(s);
  }
  return out.slice(0, limit);
}

/** The rules as documents for the knowledge server (its "Zeff" source): a page each, the tags in its text. */
export function branchRuleDocs(zeffUrl: string): { id: string; space: string; title: string; url: string; updatedAt: string | null; author: string | null; body: string }[] {
  return listBranchRules()
    .filter((r) => r.enabled)
    .map((r) => ({
      id: `zeff:branchrule:${r.id}`,
      space: "Zeff · Branch-Kontext",
      title: `Branch-Regel: ${r.title}`,
      url: `${zeffUrl}/auswerten#branchname`,
      updatedAt: r.createdAt,
      author: null,
      body: `Tags: ${r.tags.join(", ")}\n\n${r.text}${r.sources.length ? `\n\n## Woher die Regel kommt\n${r.sources.map((s) => `- ${s.label}: „${s.text}“`).join("\n")}` : ""}`,
    }));
}
