import { t } from "@/lib/i18n/server";
import type { ProposalSource } from "@/lib/proposals/point";
import { STEPS } from "@/lib/learning/ledger";
import { peopleHome, personHref } from "@/plugins/workspace/people-database";
import { applyIdentity, IDENTITY_SOURCE, identityProposalFeedback, pendingSuggestions } from "./identity";
import { listPeople } from "./store";
import { suggestionText } from "./tools";

/**
 * What People proposes through the one proposals store (@/lib/proposals): the names that may be one person. Accepting runs
 * `applyIdentity`; the review queue and the people overview both decide through `decide()`.
 */
export const PEOPLE_PROPOSALS: ProposalSource[] = [
  {
    id: IDENTITY_SOURCE,
    step: STEPS.peopleIdentity,
    get label() {
      return t("Same person?");
    },
    entries: (list) => {
      const names = new Map(listPeople().map((p) => [p.id, p.name]));
      const byId = new Map(pendingSuggestions().map((s) => [s.id, s]));
      return list.map((p) => {
        const s = byId.get(p.id);
        if (!s) return { title: p.why };
        return { title: suggestionText(s, (id) => names.get(id)), detail: s.evidence, href: s.kind === "person" ? peopleHome() : personHref(s.personId) };
      });
    },
    apply: async (p) => {
      const out = applyIdentity(p);
      // The messages before the profile existed were read past it: read the last 90 days again, for it alone.
      const pid = out.ref ? Number(out.ref.slice("person:".length)) : 0;
      if (pid && (await import("@/plugins/state")).isInstalled("llm")) void import("./extract").then((x) => x.extractKnowledge({ sinceDays: 90, only: [pid] })).catch(() => {});
      return out;
    },
    feedback: identityProposalFeedback,
  },
];
