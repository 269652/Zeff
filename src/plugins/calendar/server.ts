import { workspaceSources } from "@/plugins/workspace/source-point";
import { CALENDAR_SOURCE } from "./workspace-source";

/** What the Calendar registers for other plugins (loaded through plugins/contributions): its appointments as a source of the Workspace's pipelines. */
workspaceSources.contribute("calendar", [CALENDAR_SOURCE]);
