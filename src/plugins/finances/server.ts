import { workspaceSources } from "@/plugins/workspace/source-point";
import { DEBTS_SOURCE } from "./source";

/** What Finances registers for other plugins (loaded through plugins/contributions): the cases' debts as a source of the Workspace's pipelines. */
workspaceSources.contribute("finances", [DEBTS_SOURCE]);
