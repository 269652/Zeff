import { t } from "@/lib/i18n/server";
import { ApiError, int, str, type ApiContribution, type Params } from "@/lib/plugins/api-kit";

/**
 * The Timeline plugin's part of the plugin API: what happened with an entity (a person, a ticket, a page, a project — by its ref or a
 * name), and what changed since a time, grouped by entity. Read-only. The work is done lazily in query.ts.
 */

/** A list of texts given as an array or comma-separated. */
const list = (p: Params, k: string): string[] | undefined => {
  const v = p[k];
  if (v === undefined || v === null || v === "") return undefined;
  const arr = Array.isArray(v) ? v.map(String) : typeof v === "string" ? v.split(",") : null;
  if (!arr) throw new ApiError("bad_request", `${k}: a list of texts`);
  return arr.map((s) => s.trim()).filter(Boolean).slice(0, 30);
};

export const TIMELINE_API: ApiContribution = {
  permissions: () => ({ "timeline.read": t("Read the timeline: what happened with people, tickets, pages and projects") }),
  methods: {
    "timeline.for": {
      perm: "timeline.read",
      summary: "What happened with an entity: `ref` (person:12, ticket:PROJ-7, page:31 …) or `q` (a name, a ticket key, a project), newest first.",
      run: async (p: Params) => {
        const { timelineFor } = await import("./query");
        const r = timelineFor({ ref: str(p, "ref", { max: 300 }), q: str(p, "q", { max: 300 }), since: str(p, "since", { max: 40 }) || undefined, until: str(p, "until", { max: 40 }) || undefined, kinds: list(p, "kinds"), sources: list(p, "sources"), limit: int(p, "limit", { min: 1, max: 500 }) });
        if (!r.ok) throw new ApiError("not_found", r.error);
        return { ref: r.refs[0], refs: r.refs, label: r.label, lastSeen: r.lastSeen, events: r.events };
      },
    },
    "timeline.since": {
      perm: "timeline.read",
      summary: "What changed since `since` (a day, an ISO time or 24h / 7d), grouped by the entity it concerns — the busiest first.",
      run: async (p: Params) => {
        const { timelineSince } = await import("./query");
        const r = timelineSince({ since: str(p, "since", { required: true, max: 40 }), until: str(p, "until", { max: 40 }) || undefined, kinds: list(p, "kinds"), sources: list(p, "sources"), refKinds: list(p, "refKinds"), limit: int(p, "limit", { min: 1, max: 200 }), perGroup: int(p, "perGroup", { min: 1, max: 50 }) });
        if (!r.ok) throw new ApiError("bad_request", r.error);
        return { since: r.since, groups: r.groups };
      },
    },
  },
};
