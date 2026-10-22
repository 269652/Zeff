import { workspaceWidgets } from "@/plugins/workspace/widget-point";
import { correlationSeries } from "./series-point";
import { SIGNAL_SERIES } from "./series-signals";
import { WORKSPACE_SERIES } from "./series-workspace";
import { CORRELATION_WIDGETS } from "./widgets";

/** What Correlations registers: its series (your Workspace databases, Zeff's own signals) and its Workspace widget. */
correlationSeries.contribute("correlations", [WORKSPACE_SERIES, SIGNAL_SERIES]);
workspaceWidgets.contribute("correlations", CORRELATION_WIDGETS);
