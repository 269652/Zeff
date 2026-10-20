import { t } from "@/lib/i18n/server";
import { reviewLinks } from "@/lib/review/point";

/**
 * What the Weekly report registers for other plugins (loaded through plugins/contributions): its booking
 * suggestions in the review queue — counted and linked, as they are taken over on the report itself.
 */
reviewLinks.contribute("weekly-report", [
  {
    id: "booking-suggestions",
    get label() {
      return t("Suggested entries");
    },
    href: "/#suggestions",
    count: async () => (await import("@/lib/work/suggestions")).openSuggestionCount(),
  },
]);
