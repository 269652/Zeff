import { workspaceSources } from "@/plugins/workspace/source-point";
import { TIME_SOURCE } from "./workspace-source";

/** What Time tracking registers for other plugins (loaded through plugins/contributions): the booked time as a source of the Workspace's pipelines. */
workspaceSources.contribute("zeiterfassung", [TIME_SOURCE]);
