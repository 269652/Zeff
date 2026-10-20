import { workspaceSources } from "@/plugins/workspace/source-point";
import { JIRA_COMMENTS_SOURCE } from "./workspace-source";

/** What Jira registers for other plugins (loaded through plugins/contributions): its comments as something the Workspace's databases can join. */
workspaceSources.contribute("jira", [JIRA_COMMENTS_SOURCE]);
