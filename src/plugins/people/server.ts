import { workspaceSources } from "@/plugins/workspace/source-point";
import { workspaceWidgets } from "@/plugins/workspace/widget-point";
import { PEOPLE_WIDGETS } from "./widgets";
import { PEOPLE_SOURCE } from "./workspace-source";

/** What People registers for other plugins (loaded through plugins/contributions): its profiles as a source of the Workspace's pipelines. */
workspaceSources.contribute("people", [PEOPLE_SOURCE]);
workspaceWidgets.contribute("people", PEOPLE_WIDGETS);
