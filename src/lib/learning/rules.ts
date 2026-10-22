import { mustDo } from "@/lib/boards/must-do";
import { isChatFolder } from "@/lib/mail/shared";
import { ledgerDb, listFeedback, STEPS, type FeedbackRow } from "./ledger";

/**
 * Rules from repetition, review-first: when you reject the same thing from the same sender again and again (three todos
 * of the mail review from one sender about the same kind of mail, all dropped), Zeff proposes a rule — and only you
 * make it one. A confirmed rule lets the step leave such mails alone; one you dismiss isn't proposed again.
 *
 * Recall first, strictly: only the same kind from the same sender, never with an accepted one among them, never a must-do
 * mail (a mandatory training, a signature), never a chat (people's messages) and never a question to you — those are
 * guarded when the rule is proposed AND when it is applied, so a rule can't hold back a must-do mail that looks alike.
 */

/** The steps a learned rule can hold back for (each applies them itself). */
export const RULE_STEPS: string[] = [STEPS.mailReview];
/** How many rejections of one pattern (and no acceptance) make a proposal. */
export const RULE_THRESHOLD = 3;
const WINDOW_DAYS = 90;

export type RuleStatus = "proposed" | "confirmed" | "dismissed";
export type LearnedRule = { id: number; step: string; sender: string; kind: string; status: RuleStatus; evidence: { itemRef: string; at: string; text: string }[]; createdAt: string; decidedAt: string | null };

/**
 * A mail subject's stem — its kind, as patterns compare them: no "Re:/AW:/Fwd:", no numbers, dates or ticket keys, the
 * first six words, lowercase. "Ihre Rechnung 2026-10 Nr. 4711" and "Ihre Rechnung 2026-11 Nr. 4802" are one kind.
 */
export function subjectStem(subject: string): string {
  return subject
    .replace(/^\s*((re|aw|wg|fw|fwd)\s*:\s*)+/gi, "")
    .toLowerCase()
    .replace(/\b[a-z][a-z0-9]+-\d+\b/g, " ")
    .replace(/[0-9]+([./:-][0-9]+)*/g, " ")
    .replace(/[^\p{L}\s]+/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6)
    .join(" ");
}

/** A mail no rule may ever hold back: a must-do one, a chat, a question to you, a conversation you take part in. */
export function protectedMail(m: { fromName: string | null; fromEmail: string | null; subject: string; preview: string; folder: string }, opts: { youWrote?: boolean } = {}): boolean {
  return mustDo(m) || isChatFolder(m.folder) || /\?/.test(`${m.subject} ${m.preview}`) || !!opts.youWrote;
}

/** Whether a rejected item may count towards a rule (what was protected when it was recorded never does). */
const countable = (r: FeedbackRow) => !r.detail.mustDo && !r.detail.chat && !r.detail.question;

type Raw = { id: number; step: string; sender: string; kind: string; status: RuleStatus; evidence: string; created_at: string; decided_at: string | null };
const rule = (r: Raw): LearnedRule => ({ id: r.id, step: r.step, sender: r.sender, kind: r.kind, status: r.status, evidence: JSON.parse(r.evidence || "[]"), createdAt: r.created_at, decidedAt: r.decided_at });

/**
 * The rules repetition suggests now: per step that applies rules, each sender + kind rejected RULE_THRESHOLD times or
 * more in the last 90 days, never accepted, with nothing protected among them. New ones are written as proposed (one
 * proposed, confirmed or dismissed before stays as it is). The proposals waiting, with their evidence.
 */
export function proposeRules(now = Date.now(), threshold = RULE_THRESHOLD): LearnedRule[] {
  const since = new Date(now - WINDOW_DAYS * 864e5).toISOString();
  const db = ledgerDb();
  for (const step of RULE_STEPS) {
    const groups = new Map<string, FeedbackRow[]>();
    for (const r of listFeedback({ since, step })) {
      if (!r.sender || !r.kind) continue;
      const k = `${r.sender}\u0000${r.kind}`;
      groups.set(k, [...(groups.get(k) ?? []), r]);
    }
    for (const list of groups.values()) {
      if (list.some((r) => r.verdict === "accepted" || r.verdict === "edited")) continue;
      const rejected = list.filter((r) => r.verdict === "rejected");
      if (rejected.length < threshold || rejected.some((r) => !countable(r))) continue;
      const evidence = rejected.slice(0, 10).map((r) => ({ itemRef: r.itemRef, at: r.at, text: String(r.detail.text ?? r.detail.subject ?? r.itemRef).slice(0, 200) }));
      db.prepare(`insert or ignore into ai_feedback_rules (step, sender, kind, status, evidence, created_at) values (?, ?, ?, 'proposed', ?, ?)`).run(step, list[0].sender, list[0].kind, JSON.stringify(evidence), new Date(now).toISOString());
      // A proposal still waiting shows its latest evidence.
      db.prepare(`update ai_feedback_rules set evidence = ? where step = ? and sender = ? and kind = ? and status = 'proposed'`).run(JSON.stringify(evidence), step, list[0].sender, list[0].kind);
    }
  }
  return learnedRules({ status: "proposed" });
}

/** The learned rules, optionally of one status and step — the newest first. */
export function learnedRules(opts: { status?: RuleStatus; step?: string } = {}): LearnedRule[] {
  const where: string[] = [];
  const args: string[] = [];
  if (opts.status) (where.push("status = ?"), args.push(opts.status));
  if (opts.step) (where.push("step = ?"), args.push(opts.step));
  return (ledgerDb().prepare(`select * from ai_feedback_rules ${where.length ? `where ${where.join(" and ")}` : ""} order by created_at desc, id desc`).all(...args) as Raw[]).map(rule);
}

/** Your word on a proposed rule (or taking back a confirmed one: "dismissed"). Throws when there's no such rule. */
export function decideRule(id: number, status: "confirmed" | "dismissed"): LearnedRule {
  const r = ledgerDb().prepare(`update ai_feedback_rules set status = ?, decided_at = ? where id = ?`).run(status, new Date().toISOString(), id);
  if (!r.changes) throw new Error(`No learned rule ${id}.`);
  return rule(ledgerDb().prepare(`select * from ai_feedback_rules where id = ?`).get(id) as Raw);
}

/**
 * The confirmed rule of the mail review a mail falls under (else null) — never for a protected mail. The review leaves
 * such a mail alone (gone through, no AI).
 */
export function mailRuleFor(m: { fromName: string | null; fromEmail: string | null; subject: string; preview: string; folder: string }, rules: LearnedRule[], opts: { youWrote?: boolean } = {}): LearnedRule | null {
  if (!m.fromEmail || protectedMail(m, opts)) return null;
  const sender = m.fromEmail.toLowerCase();
  const kind = subjectStem(m.subject);
  return rules.find((r) => r.status === "confirmed" && r.step === STEPS.mailReview && r.sender === sender && r.kind === kind) ?? null;
}
