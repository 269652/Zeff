import type { JiraStatusCategory } from "@/db/schema";

export type NormalizedTicket = {
  key: string;
  summary: string;
  /** Shortened description text; undefined when the sync didn't ask for it. */
  description?: string | null;
  status: string;
  statusCategory: JiraStatusCategory;
  issueType?: string | null;
  priority?: string | null;
  assignee?: string | null;
  url?: string | null;
  openedAt?: string | null;
  updatedAt?: string | null;
  resolvedAt?: string | null;
  /** First status transition from the changelog (time-to-respond signal). */
  respondedAt?: string | null;
};

const KEY_RE = /^[A-Z][A-Z0-9]+-\d+$/;

function str(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return undefined;
}

/**
 * Earliest "response" from a Jira changelog: the first status transition, or, if
 * none, the first change of any kind. Handles mcp-atlassian's flattened
 * `changelogs` array and raw REST `changelog.histories`. Timestamps are ISO
 * strings and compared lexically (same format), which is exact enough for days.
 */
function firstResponseAt(o: Record<string, unknown>): string | null {
  let histories: unknown[] = [];
  if (Array.isArray(o.changelogs)) {
    histories = o.changelogs;
  } else if (o.changelog && typeof o.changelog === "object") {
    const cl = o.changelog as Record<string, unknown>;
    if (Array.isArray(cl.histories)) histories = cl.histories;
    else if (Array.isArray(cl.values)) histories = cl.values;
  }
  let firstStatus: string | null = null;
  let firstAny: string | null = null;
  for (const h of histories) {
    if (!h || typeof h !== "object") continue;
    const he = h as Record<string, unknown>;
    const created = str(he.created) ?? str(he.timestamp);
    if (!created) continue;
    if (!firstAny || created < firstAny) firstAny = created;
    const items = Array.isArray(he.items) ? he.items : [];
    const hasStatus = items.some(
      (x) => x && typeof x === "object" && String((x as Record<string, unknown>).field ?? "").toLowerCase() === "status",
    );
    if (hasStatus && (!firstStatus || created < firstStatus)) firstStatus = created;
  }
  return firstStatus ?? firstAny;
}

/** Map a Jira status name or category key to a coarse category. */
export function toStatusCategory(catKey?: string, statusName?: string): JiraStatusCategory {
  const k = (catKey ?? "").toLowerCase();
  if (k === "done" || k === "green" || k === "success" || k === "fertig" || k === "erledigt") return "done";
  if (k === "indeterminate" || k === "inprogress" || k === "in progress" || k === "yellow" || k === "warning")
    return "inprogress";
  if (["new", "todo", "to do", "blue-gray", "bluegray", "medium-gray", "default", "offen", "neu"].includes(k))
    return "todo";

  const s = (statusName ?? "").toLowerCase();
  if (/done|closed|resolved|complete|fertig|geschlossen|erledigt|abgeschlossen/.test(s)) return "done";
  if (/progress|review|doing|testing|in arbeit|bearbeitung|prüfung|pruefung|umsetzung|qa|überarbeit|ueberarbeit|erstellung/.test(s)) return "inprogress";
  if (/todo|to do|open|backlog|offen|neu|selected|zu erledigen|ready|bereit/.test(s)) return "todo";
  return "unknown";
}

/**
 * Normalize a Jira issue from many possible shapes (raw REST `{key, fields}`,
 * or a flattened object from an MCP tool) into a NormalizedTicket. Returns null
 * when there is no recognizable issue key.
 */
export function normalizeIssue(raw: unknown, baseUrl?: string): NormalizedTicket | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const fields = (o.fields && typeof o.fields === "object" ? (o.fields as Record<string, unknown>) : o) as Record<string, unknown>;

  const key = str(o.key) ?? str(o.issueKey) ?? str(fields.key);
  if (!key || !KEY_RE.test(key.toUpperCase())) return null;
  const upperKey = key.toUpperCase();

  // Status can be {name, statusCategory:{key,name}} (REST), {name, category, color}
  // (mcp-atlassian flattened), or a plain string.
  const statusRaw = fields.status ?? o.status;
  let statusName = "";
  let catKey: string | undefined;
  if (statusRaw && typeof statusRaw === "object") {
    const sObj = statusRaw as Record<string, unknown>;
    statusName = str(sObj.name) ?? "";
    const cat = sObj.statusCategory as Record<string, unknown> | undefined;
    catKey = str(cat?.key) ?? str(cat?.name) ?? str(sObj.category) ?? str(sObj.color);
  } else {
    statusName = str(statusRaw) ?? "";
  }
  catKey = catKey ?? str(o.statusCategory) ?? str(fields.statusCategory);

  const assigneeRaw = fields.assignee ?? o.assignee;
  const assignee =
    assigneeRaw && typeof assigneeRaw === "object"
      ? str((assigneeRaw as Record<string, unknown>).displayName) ??
        str((assigneeRaw as Record<string, unknown>).display_name) ??
        str((assigneeRaw as Record<string, unknown>).name)
      : str(assigneeRaw);

  const typeRaw = fields.issuetype ?? o.issueType ?? o.issue_type ?? o.type;
  const issueType =
    typeRaw && typeof typeRaw === "object" ? str((typeRaw as Record<string, unknown>).name) : str(typeRaw);

  const prioRaw = fields.priority ?? o.priority;
  const priority =
    prioRaw && typeof prioRaw === "object" ? str((prioRaw as Record<string, unknown>).name) : str(prioRaw);

  const url =
    str(o.url) ??
    str(o.webLink) ??
    str(o.browse_url) ??
    str(fields.browse_url) ??
    (baseUrl ? `${baseUrl.replace(/\/$/, "")}/browse/${upperKey}` : undefined);

  return {
    key: upperKey,
    summary: str(fields.summary) ?? str(o.summary) ?? "",
    description: descriptionOf(fields.description ?? o.description),
    status: statusName,
    statusCategory: toStatusCategory(catKey, statusName),
    issueType: issueType ?? null,
    priority: priority ?? null,
    assignee: assignee ?? null,
    url: url ?? null,
    openedAt: str(fields.created) ?? str(o.created) ?? str(o.createdAt) ?? str(o.opened) ?? null,
    updatedAt: str(fields.updated) ?? str(o.updated) ?? str(o.updatedAt) ?? null,
    resolvedAt: str(fields.resolutiondate) ?? str(o.resolutiondate) ?? str(o.resolved) ?? str(o.resolvedAt) ?? null,
    respondedAt: firstResponseAt(o),
  };
}

const DESCRIPTION_MAX = 2000;

/** A description as text (Jira Server returns a string; anything else is left out), shortened. */
function descriptionOf(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  return t.length > DESCRIPTION_MAX ? t.slice(0, DESCRIPTION_MAX - 1).trimEnd() + "…" : t;
}

/** Pull an array of issues out of the many container shapes tools return. */
export function extractIssues(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") {
    const o = payload as Record<string, unknown>;
    for (const k of ["issues", "results", "values", "data", "tickets"]) {
      if (Array.isArray(o[k])) return o[k] as unknown[];
    }
  }
  return [];
}
