import { workspaceMetrics } from "@/plugins/workspace/metric-point";
import { loopCounts } from "./query";

/** What the loops plugin registers for other plugins (loaded through plugins/contributions): its counts as Kennzahlen. */
workspaceMetrics.contribute("loops", [
  { label: "Offene Zusagen", unit: "", what: "What you promised someone and haven't done yet (the open loops)", read: () => loopCounts().mine, href: () => "/loops" },
  { label: "Zusagen an dich", unit: "", what: "What others promised you and haven't done yet", read: () => loopCounts().theirs, href: () => "/loops" },
  { label: "Überfällige Zusagen", unit: "", what: "Promises past their day, both ways", read: () => loopCounts().overdue, href: () => "/loops" },
]);
