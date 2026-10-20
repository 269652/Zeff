import { workspaceSources } from "@/plugins/workspace/source-point";
import { workspaceWidgets } from "@/plugins/workspace/widget-point";
import { CALENDAR_SOURCE } from "./workspace-source";
import { CALENDAR_WIDGETS } from "./widgets";

/** What the Calendar registers for other plugins (loaded through plugins/contributions): its appointments as a source of the Workspace's pipelines. */
workspaceSources.contribute("calendar", [CALENDAR_SOURCE]);
workspaceWidgets.contribute("calendar", CALENDAR_WIDGETS);
