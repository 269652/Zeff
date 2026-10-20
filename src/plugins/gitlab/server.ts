import { workspaceSources } from "@/plugins/workspace/source-point";
import { MRS_SOURCE } from "./workspace-source";

/** What GitLab registers for other plugins (loaded through plugins/contributions): the merge requests as something the Workspace's databases can join. */
workspaceSources.contribute("gitlab", [MRS_SOURCE]);
