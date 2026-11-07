import { str, newId, defined, posInt, strs, ids } from "./util";

/** The sources a pipeline can read: Jira's tickets, Google Keep's notes, the todos, another database of the Workspace, the addresses of the knowledge base. */
export const PIPELINE_SOURCES = ["jira", "keep", "todos", "database", "mail", "messages", "knowledge", "ext"] as const;
/** What a database's rows can be, by their sources: mails (Outlook, Gmail), messages (Teams, WhatsApp, Signal). */
export const DATA_TYPES = ["mail", "message", "inbox", "people", "news", "calendar", "documents", "cases", "debts", "agenda"] as const;
export type DataType = (typeof DATA_TYPES)[number];
export const MAIL_ACCOUNTS = ["outlook", "gmail", "imap"] as const;
export const MESSAGE_CHANNELS = ["teams", "whatsapp", "signal"] as const;
/** Which mails: of these accounts (none: all), in these folders, unread only, received within days. */
export type MailCriteria = { accounts?: (typeof MAIL_ACCOUNTS)[number][]; folders?: string[]; unreadOnly?: boolean; recentDays?: number };
/** Which messages: of these channels (none: all), chats named like this, sent within days. */
export type MessageCriteria = { channels?: (typeof MESSAGE_CHANNELS)[number][]; chat?: string; recentDays?: number };
/** Which addresses: those the knowledge base holds for these search terms (a project, a system); not the ones the database `excludeDb` (or this one, by hand) has already. */
export type KnowledgeCriteria = { terms: string[]; excludeDb?: number };
export type PipelineSource = (typeof PIPELINE_SOURCES)[number];
/**
 * Which Jira tickets: on you, or followed, or in the Ticket-Lage (either; none set: any); moved / commented within days;
 * open (and done within doneDays still); of these projects.
 */
export type JiraCriteria = { mine?: boolean; involved?: boolean; briefed?: boolean; recentDays?: number; commented?: boolean; openOnly?: boolean; doneDays?: number; projects?: string[] };

/**
 * A step of a pipeline. source: rows from `from` (jira by `jira`, keep by `label`, todos by `todoStatus`, a database by
 * `dbId`). filter: only the rows with `text`, open (`openOnly`), changed within `recentDays`, the first `limit`. ai: a field
 * on each row (`output` field: `name`, `prompt`, `choices` — kept as the AI property `prop`), or one text over all of them
 * (`output` summary: `prompt`, its last `result`).
 */
export type PipelineStep = {
  id: string;
  kind: "source" | "filter" | "ai" | "sort" | "write" | "set" | "join" | "rules";
  from?: PipelineSource;
  jira?: JiraCriteria;
  mail?: MailCriteria;
  messages?: MessageCriteria;
  knowledge?: KnowledgeCriteria;
  /** A source a plugin brings (from "ext"): its id — People's profiles ("people"). */
  ext?: string;
  label?: string;
  todoStatus?: "open" | "all";
  dbId?: number;
  text?: string;
  openOnly?: boolean;
  recentDays?: number;
  limit?: number;
  output?: "field" | "summary" | "filter" | "actions";
  /** Filter: "hide" leaves out the noise (lib/noise: newsletters, bots, money only moved, duplicates) — before any AI filter. */
  noise?: "hide";
  /** Filter: rules as Outlook's (a field by its name, a condition, a value) — all of them, or any. */
  rules?: FilterRule[];
  match?: "all" | "any";
  /** Write: the database the rows that come out are put into (title, the fields of the same name, the text once). */
  to?: number;
  /** Sort: the field (its name) the rows go by, and which way. Join: the field of the other database a name is matched with (default: its title). */
  by?: string;
  dir?: "asc" | "desc";
  prop?: string;
  /** Set: the value the field (`name`) gets on the rows its rules match. */
  setValue?: string;
  /** Join: the field here (its name) that names a row of the database `dbId`, the field there it is matched with (default: its title), and the fields there brought along. */
  on?: string;
  bring?: string[];
  /** Join: "inner" drops the records that find no row (default: they stay). */
  joinType?: "inner";
  /** Join: a name matches only when it is the key (default: the key may be inside it - an address in "Name <address>"). */
  exact?: boolean;
  /** Join: with several rows that match - "all": their values come together ("a, b"); "expand": one record per row. Default: the first. */
  many?: "all" | "expand";
  name?: string;
  prompt?: string;
  choices?: string[];
  /** AI steps: the instructions (pages under KI-Anweisungen) that go with the prompt. */
  instructions?: number[];
  result?: { text: string; at: string; hash?: string };
};
/** A pipeline: its steps; when it last ran; and how it runs by itself — its AI after every sync of its sources, and/or every N minutes. */
export type Pipeline = { steps: PipelineStep[]; ranAt?: string; autoAi?: boolean; everyMinutes?: number; /** A checkbox property (its id): a row ticked in it is final — a run neither changes nor archives it, and the AI leaves it. */ keepProp?: string };

/** A filter's conditions: contains, doesn't contain, is, isn't (a checkbox: yes / no), empty, not empty. */
export const FILTER_OPS = ["contains", "not_contains", "is", "is_not", "empty", "not_empty"] as const;
export type FilterRule = { field: string; op: (typeof FILTER_OPS)[number]; value?: string };

/** A pipeline as stored: its steps kept to what they can be (unknown ones dropped, each with an id). */
export function normalizePipeline(raw: unknown): Pipeline {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const steps: PipelineStep[] = [];
  for (const x of Array.isArray(o.steps) ? o.steps : []) {
    if (!x || typeof x !== "object") continue;
    const s = x as Record<string, unknown>;
    const id = str(s.id) ?? newId("s");
    if (s.kind === "source") {
      if (!(PIPELINE_SOURCES as readonly unknown[]).includes(s.from)) continue;
      const from = s.from as PipelineSource;
      const j = (s.jira && typeof s.jira === "object" ? s.jira : {}) as Record<string, unknown>;
      const jira = from === "jira" ? defined<JiraCriteria>({ mine: j.mine === true, involved: j.involved === true, briefed: j.briefed === true, recentDays: posInt(j.recentDays), commented: j.commented === true, openOnly: j.openOnly === true, doneDays: posInt(j.doneDays), projects: strs(j.projects) }) : undefined;
      const ml = (s.mail && typeof s.mail === "object" ? s.mail : {}) as Record<string, unknown>;
      const mg = (s.messages && typeof s.messages === "object" ? s.messages : {}) as Record<string, unknown>;
      const mail = from === "mail" ? defined<MailCriteria>({ accounts: strs(ml.accounts)?.filter((a): a is MailCriteria["accounts"] & string => (MAIL_ACCOUNTS as readonly string[]).includes(a)) as MailCriteria["accounts"], folders: strs(ml.folders), unreadOnly: ml.unreadOnly === true, recentDays: posInt(ml.recentDays) }) : undefined;
      const messages = from === "messages" ? defined<MessageCriteria>({ channels: strs(mg.channels)?.filter((c) => (MESSAGE_CHANNELS as readonly string[]).includes(c)) as MessageCriteria["channels"], chat: str(mg.chat), recentDays: posInt(mg.recentDays) }) : undefined;
      const kn = (s.knowledge && typeof s.knowledge === "object" ? s.knowledge : {}) as Record<string, unknown>;
      const terms = strs(kn.terms);
      const knowledge = from === "knowledge" && terms ? defined<KnowledgeCriteria>({ terms, excludeDb: posInt(kn.excludeDb) }) : undefined;
      if (from === "ext" && !str(s.ext)) continue;
      steps.push(defined<PipelineStep>({ id, kind: "source", from, jira, mail, messages, knowledge, ext: from === "ext" ? str(s.ext) : undefined, label: from === "keep" || from === "ext" ? str(s.label) : undefined, todoStatus: from === "todos" && s.todoStatus === "all" ? "all" : undefined, dbId: from === "database" ? posInt(s.dbId) : undefined }));
    } else if (s.kind === "filter") {
      const rules = (Array.isArray(s.rules) ? s.rules : []).flatMap((x): FilterRule[] => {
        const r = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
        const field = str(r.field);
        if (!field || !(FILTER_OPS as readonly unknown[]).includes(r.op)) return [];
        return [defined<FilterRule>({ field, op: r.op as FilterRule["op"], value: typeof r.value === "string" ? r.value : undefined })];
      });
      steps.push(defined<PipelineStep>({ id, kind: "filter", text: str(s.text), openOnly: s.openOnly === true, recentDays: posInt(s.recentDays), limit: posInt(s.limit), rules: rules.length ? rules : undefined, match: rules.length && s.match === "any" ? "any" : undefined, noise: s.noise === "hide" ? "hide" : undefined }));
    } else if (s.kind === "rules") {
      // Rules read from a rules database (`dbId`); a rule that hands a record to an agent makes its job in `to`.
      if (posInt(s.dbId)) steps.push(defined<PipelineStep>({ id, kind: "rules", dbId: posInt(s.dbId), to: posInt(s.to) }));
    } else if (s.kind === "write") {
      if (posInt(s.to)) steps.push(defined<PipelineStep>({ id, kind: "write", to: posInt(s.to) }));
    } else if (s.kind === "join") {
      if (posInt(s.dbId) && str(s.on)) steps.push(defined<PipelineStep>({ id, kind: "join", dbId: posInt(s.dbId), on: str(s.on), by: str(s.by), bring: strs(s.bring), joinType: s.joinType === "inner" ? "inner" : undefined, exact: s.exact === true ? true : undefined, many: s.many === "all" || s.many === "expand" ? s.many : undefined }));
    } else if (s.kind === "set") {
      const rules = (Array.isArray(s.rules) ? s.rules : []).flatMap((x): FilterRule[] => {
        const r = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
        const field = str(r.field);
        if (!field || !(FILTER_OPS as readonly unknown[]).includes(r.op)) return [];
        return [defined<FilterRule>({ field, op: r.op as FilterRule["op"], value: typeof r.value === "string" ? r.value : undefined })];
      });
      if (str(s.name)) steps.push(defined<PipelineStep>({ id, kind: "set", name: str(s.name), setValue: typeof s.setValue === "string" ? s.setValue.trim() : "", rules: rules.length ? rules : undefined, match: rules.length && s.match === "any" ? "any" : undefined }));
    } else if (s.kind === "sort") {
      if (str(s.by)) steps.push(defined<PipelineStep>({ id, kind: "sort", by: str(s.by), dir: s.dir === "desc" ? "desc" : undefined }));
    } else if (s.kind === "ai" && (s.output === "field" || s.output === "summary" || s.output === "filter" || s.output === "actions")) {
      const r = s.result as { text?: unknown; at?: unknown; hash?: unknown } | undefined;
      const result = r && typeof r.text === "string" && typeof r.at === "string" ? { text: r.text, at: r.at, ...(typeof r.hash === "string" ? { hash: r.hash } : {}) } : undefined;
      steps.push(defined<PipelineStep>({ id, kind: "ai", output: s.output, prop: s.output === "field" ? str(s.prop) : undefined, name: s.output === "field" ? (str(s.name) ?? "AI") : undefined, prompt: str(s.prompt), choices: s.output === "field" ? strs(s.choices) : undefined, instructions: ids(s.instructions), result: s.output === "summary" ? result : undefined }));
    }
  }
  return { steps, ...(typeof o.ranAt === "string" ? { ranAt: o.ranAt } : {}), ...(o.autoAi === true ? { autoAi: true } : {}), ...(posInt(o.everyMinutes) ? { everyMinutes: Math.min(10080, posInt(o.everyMinutes)!) } : {}), ...(str(o.keepProp) ? { keepProp: str(o.keepProp) } : {}) };
}
