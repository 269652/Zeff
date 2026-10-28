import { workspaceSources } from "@/plugins/workspace/source-point";
import { workspaceWidgets } from "@/plugins/workspace/widget-point";
import { workspaceMetrics } from "@/plugins/workspace/metric-point";
import { FINANCES_METRICS } from "./metrics";
import { DEBTS_SOURCE, RECURRING_SOURCE } from "./source";
import { FINANCES_WIDGETS } from "./widgets";
import "./todo-settle"; // (a debt down when the todo paying it is done)

/** What Finances registers for other plugins (loaded through plugins/contributions): the cases' debts as a source of the Workspace's pipelines, its widgets. */
workspaceSources.contribute("finances", [DEBTS_SOURCE, RECURRING_SOURCE]);
workspaceWidgets.contribute("finances", FINANCES_WIDGETS);
// Its numbers as Kennzahlen: Tilgungsrate, Schuldenstand, Sparquote … (kennzahl("…") in formulas, @… in pages).
workspaceMetrics.contribute("finances", FINANCES_METRICS);
