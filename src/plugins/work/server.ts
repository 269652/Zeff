import { apiPoint } from "@/lib/plugins/api-point";
import { workspaceWidgets } from "@/plugins/workspace/widget-point";
import { WORK_API } from "./api";
import { WORK_WIDGETS } from "./widgets";
import { workspaceSources } from "@/plugins/workspace/source-point";
import { RUNS_SOURCE } from "./workspace-source";

/** What Work registers for other plugins (loaded through plugins/contributions). */
apiPoint.contribute("work", WORK_API);
workspaceWidgets.contribute("work", WORK_WIDGETS);
// … and its runs as something the Workspace's databases can join (by ticket).
workspaceSources.contribute("work", [RUNS_SOURCE]);
