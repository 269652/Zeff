import type { T } from "@/lib/i18n/shared";

/**
 * Open loops, the shared model (client-safe): a loop is something still open between you and someone — a promise (a commitment
 * claim of the People plugin, read by the AI), a question or request to you nobody answered, your question still without an
 * answer, a Jira comment addressed to you (read by rule). Its direction says who owes: "mine" — you owe them; "theirs" — they owe
 * you. And the rules that tell a question, a request and a "later" apart — pure, so the tests and the UI read the same.
 */

export type LoopKind = "commitment" | "question" | "request" | "mention";
/** mine: I owe it (to them); theirs: they owe it (to me). */
export type LoopDirection = "mine" | "theirs";
export type LoopState = "open" | "closed" | "dismissed";
export type ClosedBy = "rule" | "ai" | "you";

export type Loop = {
  /** "claim:<people_claims id>" (a commitment) or "q:<source>:<key>" (a question, request or mention read by rule). */
  ref: string;
  kind: LoopKind;
  direction: LoopDirection;
  /** ai: read by the AI (a commitment claim); rule: read by rule. */
  origin: "ai" | "rule";
  personId: number | null;
  /** Who it is with: the person's name, else the sender as the source names them. */
  who: string;
  text: string;
  /** The words it was read from. */
  quote: string;
  /** When it was said (ISO). */
  at: string;
  /** YYYY-MM-DD or "". */
  due: string;
  /** Where it was said: "mail:<key>" (mail, WhatsApp, Signal, Gmail), "teams:<key>", "jira-comment:<id>", "doc:<id>" … */
  sourceRef: string;
  /** Its boundary source (lib/boundaries): mail, gmail, whatsapp, signal, teams, jira … */
  source: string;
  href: string;
  /** You confirmed it (a rule's loop: true — it is what the source says). */
  confirmed: boolean;
  confidence: number;
  overdue: boolean;
  state: LoopState;
  closedBy: ClosedBy | null;
  closedAt: string | null;
  /** What closed it (a closing message's words), or what the AI proposes closes it. */
  closeQuote: string;
  closeRef: string;
  /** A message that may close it — read by rule (a reply about it) or by the AI — you confirm (null: no proposal). */
  proposal: { quote: string; ref: string; href: string; at: string; by: "rule" | "ai" } | null;
  snoozedUntil: string | null;
};

export const LOOP_VIEWS = ["mine", "theirs", "overdue", "closed"] as const;
export type LoopView = (typeof LOOP_VIEWS)[number];

/** A loop without a date is overdue once it has been open this long. */
export const OVERDUE_DAYS = 7;
/** How many overdue loops the Today page nudges about at most. */
export const NUDGE_CAP = 5;
/** How long "Later" keeps a loop off the Today page. */
export const SNOOZE_DAYS = 3;

const URL_RE = /\bhttps?:\/\/\S+/gi;

/** A question: a question mark outside links. */
export const isQuestion = (text: string): boolean => /\?/.test(String(text ?? "").replace(URL_RE, ""));

/** A request to review, approve, sign or give feedback (German and English). */
const REQUEST = [
  /\b(review|reviewen|gegenlesen|gegencheck|freigabe|freigeben|freizugeben|unterschrift|unterschreiben|unterzeichnen|signieren|zur prüfung|zur ansicht|abnahme|abnehmen|approve|approval|sign off|sign-off|signature|please sign)\b/i,
  /\b(bitte|kannst du|könntest du|kannst du mal|würdest du|could you|can you|would you|please)\b[^.!?\n]{0,80}\b(prüfen|anschauen|ansehen|drüberschauen|drüber schauen|checken|testen|rückmeld\w*|feedback|bestätigen|schicken|senden|look|check|confirm|send)\b/i,
];
export const isRequest = (text: string): boolean => REQUEST.some((r) => r.test(String(text ?? "")));

/** A reply that puts it off ("mach ich morgen", "later") or promises it once more ("mach ich", "kümmere mich") — no delivery. */
const DEFERRAL = /\b(morgen|übermorgen|später|nachher|gleich|bald|demnächst|noch nicht|komme? (noch )?nicht dazu|nächste woche|mach ich|mache ich|kümmere mich|schau ich|schaue ich|erledige ich|tomorrow|later|soon|not yet|next week|will do|i'll)\b/i;
/** A short acknowledgment ("Ja gerne", "ok", "Jap") — no delivery either. */
const ACK = /^\s*(ja|jap|jo|jup|yes|ok|okay|oki|gerne|klar|passt|super|danke|alles klar|top|cool|perfekt|gut|sure|thanks)\b[^\n]{0,20}$/i;
const ACK_EMOJI = /^\s*(👍|🙏|👌|✅)+\s*$/u;
export const isDeferral = (text: string): boolean => {
  const s = String(text ?? "");
  return DEFERRAL.test(s) || ACK.test(s) || ACK_EMOJI.test(s);
};

/** Words that say nothing about what was promised (German and English filler, days, "send", "promised" …). */
const FILLER = new Set(
  "aber alle alles also auch bitte dann dass dein deine denn dich dies diese dieser doch eine einen einem einer etwas euch gerne gern habe haben hast heute hier ihnen ihre jetzt kann kannst klar machen mache mal mich mein meine mir morgen nach noch nicht oder schon sein seine sich sind soll sollen über uns unser vielleicht viel von wann warum weil wenn werde werden wieder will wird wollte zeit zugesagt zusagen schicke schickt schicken schick senden sende sendet geben gibt bekommt bekommen liefert liefern zurück zurückzuschicken bringt bringen fragt fragen frage montag dienstag mittwoch donnerstag freitag samstag sonntag woche nächste nächsten erledigt danke about after again also been from have just later more need only please send sent some soon that then there this today tomorrow will with would your"
    .split(" "),
);

const words = (s: string, skip: Set<string>): string[] =>
  (String(s ?? "").toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []).filter((w) => !FILLER.has(w) && !skip.has(w));

/**
 * Whether a reply is about the promise: words of substance they share — two of them, or one long one (eight letters and more) — the
 * same word or the same first six letters ("Unterlagen" / "Unterlage"); names (`skip`: the people's) and filler left out.
 */
export function sharesTopic(promise: string, reply: string, skip: string[] = []): boolean {
  const no = new Set(skip.flatMap((n) => n.toLowerCase().split(/\s+/)));
  const a = [...new Set(words(promise, no))];
  const b = new Set(words(reply, no));
  const stems = new Set([...b].filter((w) => w.length >= 6).map((w) => w.slice(0, 6)));
  const shared = a.filter((w) => b.has(w) || (w.length >= 6 && stems.has(w.slice(0, 6))));
  return shared.length >= 2 || shared.some((w) => w.length >= 8);
}

/** A promise to send something — an attachment sent after it is its delivery. */
export const isSendPromise = (text: string): boolean => /\b(schick|send|anhang|datei|foto|bild|unterlage|dokument|liste|link|pdf|rechnung|angebot|attach|file)/i.test(String(text ?? ""));

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A text addressed to you: one of your names or handles (@morrossl, [~morrossl]) as a word of its own — your first name too. */
export function addressedTo(text: string, names: string[], handles: string[] = []): boolean {
  const s = String(text ?? "");
  const words = new Set<string>();
  for (const n of names.map((x) => x.trim()).filter(Boolean)) {
    words.add(n);
    const first = n.split(/\s+/)[0];
    if (first && first.length >= 3) words.add(first);
  }
  for (const h of handles.map((x) => x.trim().replace(/^@/, "")).filter(Boolean)) {
    if (new RegExp(String.raw`(@|\[~)${escape(h)}\b`, "i").test(s)) return true;
  }
  for (const w of words) if (new RegExp(String.raw`(^|[^\p{L}\p{N}])@?${escape(w)}($|[^\p{L}\p{N}])`, "iu").test(s)) return true;
  return false;
}

/** The day (YYYY-MM-DD, local) of a time. */
export const localDay = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Overdue: its day is past, or (no day) it has been open for OVERDUE_DAYS. */
export function isOverdue(l: { due: string; at: string }, now = new Date()): boolean {
  if (l.due) return l.due < localDay(now);
  const at = Date.parse(l.at);
  return Number.isFinite(at) && now.getTime() - at >= OVERDUE_DAYS * 864e5;
}

/** Who owes, as a label. */
export const directionLabel = (t: T, d: LoopDirection): string => (d === "mine" ? t("I owe") : t("They owe"));

export function kindLabel(t: T, k: LoopKind): string {
  switch (k) {
    case "commitment":
      return t("Promise");
    case "question":
      return t("Question");
    case "request":
      return t("Request");
    case "mention":
      return t("Mention");
  }
}

export function viewLabel(t: T, v: LoopView): string {
  switch (v) {
    case "mine":
      return t("I owe");
    case "theirs":
      return t("Owed to me");
    case "overdue":
      return t("Overdue");
    case "closed":
      return t("Closed");
  }
}
