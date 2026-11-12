import { workspaceSources } from "@/plugins/workspace/source-point";
import { flowActionsPoint } from "@/plugins/workspace/flows/actions";
import { JIRA_FLOW_ACTIONS } from "./flow-actions";
import { JIRA_TICKETS_SOURCE } from "./tickets-source";
import { JIRA_COMMENTS_SOURCE } from "./workspace-source";

/**
 * What Jira registers for other plugins (loaded through plugins/contributions): its comments as something the Workspace's databases can join,
 * its tickets as the source of Jira's app in the Workspace, and what flows can do in Jira (comment, move, assign, sync).
 */
workspaceSources.contribute("jira", [JIRA_COMMENTS_SOURCE, JIRA_TICKETS_SOURCE]);
flowActionsPoint.contribute("jira", JIRA_FLOW_ACTIONS);
