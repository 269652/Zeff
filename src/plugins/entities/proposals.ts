import { t } from "@/lib/i18n/server";
import { STEPS } from "@/lib/learning/ledger";
import type { ProposalSource } from "@/lib/proposals/point";
import { applyEntitySuggestion, ENTITY_SOURCE, pendingEntitySuggestions } from "./suggest";
import { entitySuggestionText } from "./tools";

/**
 * What the Entities plugin proposes through the one proposals store (@/lib/proposals): organisations, places and projects found
 * in the sources, other names and links of the ones you have, and ones that are the same. Yes does what it says (through
 * `decide()`, the ledger written); no is remembered and never proposed again.
 */
export const ENTITY_PROPOSALS: ProposalSource[] = [
  {
    id: ENTITY_SOURCE,
    step: STEPS.entities,
    get label() {
      return t("Organisations, projects and places");
    },
    entries: (list) => {
      const byId = new Map(pendingEntitySuggestions().map((s) => [s.id, s]));
      return list.map((p) => {
        const s = byId.get(p.id);
        return s ? { title: entitySuggestionText(s), detail: s.evidence, href: "/workspace" } : { title: p.why };
      });
    },
    apply: applyEntitySuggestion,
    feedback: (p) => ({ detail: { text: String((p.payload as { name?: string }).name ?? ""), evidence: p.why, subjectRef: p.subjectRef, confidence: p.confidence } }),
  },
];
