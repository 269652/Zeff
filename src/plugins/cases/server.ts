import { workspaceSources } from "@/plugins/workspace/source-point";
import { CASES_SOURCE } from "./workspace-source";

/** What Cases registers for other plugins (loaded through plugins/contributions): its cases as a source of the Workspace's pipelines. */
workspaceSources.contribute("cases", [CASES_SOURCE]);
