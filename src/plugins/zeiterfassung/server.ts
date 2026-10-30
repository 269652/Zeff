import { t } from "@/lib/i18n/server";
import { reviewLinks } from "@/lib/review/point";
import { workspaceSources } from "@/plugins/workspace/source-point";
import { TIME_SOURCE } from "./workspace-source";

/** What Time tracking registers for other plugins (loaded through plugins/contributions): the booked time as a source of the Workspace's pipelines. */
workspaceSources.contribute("zeiterfassung", [TIME_SOURCE]);

/** The weekly report's booking suggestions in the review queue — counted and linked, as they are taken over on the report itself. */
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
