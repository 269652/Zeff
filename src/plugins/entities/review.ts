import { t } from "@/lib/i18n/server";
import type { ReviewSource } from "@/lib/review/point";
import { acceptEntitySuggestion, pendingEntitySuggestions, rejectEntitySuggestion } from "./suggest";
import { entitySuggestionText } from "./tools";

/**
 * What the Entities plugin has you confirm, for the review queue: organisations, places and projects found in the sources,
 * other names and links of the ones you have, and ones that are the same. Yes does what it says; no is remembered.
 */
export const ENTITIES_REVIEW: ReviewSource[] = [
  {
    id: "entities",
    get label() {
      return t("Organisations, projects and places");
    },
    list: () =>
      pendingEntitySuggestions().map((s) => ({
        id: String(s.id),
        title: entitySuggestionText(s),
        detail: s.evidence,
        confidence: s.confidence,
        href: "/workspace",
        actions: [
          { id: "yes", label: t("Right"), primary: true },
          { id: "no", label: t("Wrong") },
        ],
      })),
    act: (id, action) => {
      if (action === "yes") acceptEntitySuggestion(Number(id));
      else if (action === "no") rejectEntitySuggestion(Number(id));
      else throw new Error(t("Unknown action: {action}", { action }));
    },
  },
];
