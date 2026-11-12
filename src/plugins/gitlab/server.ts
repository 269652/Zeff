import { workspaceSources } from "@/plugins/workspace/source-point";
import { flowActionsPoint } from "@/plugins/workspace/flows/actions";
import { GITLAB_FLOW_ACTIONS } from "./flow-actions";
import { GITLAB_ITEMS_SOURCE } from "./items-source";
import { MRS_SOURCE } from "./workspace-source";

/**
 * What GitLab registers for other plugins (loaded through plugins/contributions): the merge requests as something the Workspace's databases
 * can join, its items as the source of GitLab's app in the Workspace, and what flows can do in GitLab (answer, resolve, merge, sync).
 */
workspaceSources.contribute("gitlab", [MRS_SOURCE, GITLAB_ITEMS_SOURCE]);
flowActionsPoint.contribute("gitlab", GITLAB_FLOW_ACTIONS);
