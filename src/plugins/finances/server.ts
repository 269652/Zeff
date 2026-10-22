import { workspaceSources } from "@/plugins/workspace/source-point";
import { workspaceWidgets } from "@/plugins/workspace/widget-point";
import { DEBTS_SOURCE, RECURRING_SOURCE } from "./source";
import { FINANCES_WIDGETS } from "./widgets";

/** What Finances registers for other plugins (loaded through plugins/contributions): the cases' debts as a source of the Workspace's pipelines, its widgets. */
workspaceSources.contribute("finances", [DEBTS_SOURCE, RECURRING_SOURCE]);
workspaceWidgets.contribute("finances", FINANCES_WIDGETS);
