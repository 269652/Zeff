import { correlationSeries } from "@/plugins/correlations/series-point";
import { workspaceSources } from "@/plugins/workspace/source-point";
import { SLEEP_SERIES } from "./sleep-series";
import { workspaceWidgets } from "@/plugins/workspace/widget-point";
import { CALENDAR_SOURCE } from "./workspace-source";
import { CALENDAR_WIDGETS } from "./widgets";

/** What the Calendar registers for other plugins (loaded through plugins/contributions): its appointments as a source of the Workspace's pipelines. */
workspaceSources.contribute("calendar", [CALENDAR_SOURCE]);
workspaceWidgets.contribute("calendar", CALENDAR_WIDGETS);
// Sleep (a sleep tracker's calendar) as daily series for the Correlations.
correlationSeries.contribute("calendar", [SLEEP_SERIES]);
