import { apiPoint } from "@/lib/plugins/api-point";
import { workspaceWidgets } from "@/plugins/workspace/widget-point";
import { WORK_API } from "./api";
import { WORK_WIDGETS } from "./widgets";

/** What Work registers for other plugins (loaded through plugins/contributions). */
apiPoint.contribute("work", WORK_API);
workspaceWidgets.contribute("work", WORK_WIDGETS);
