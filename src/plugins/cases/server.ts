import { workspaceSources } from "@/plugins/workspace/source-point";
import { workspaceWidgets } from "@/plugins/workspace/widget-point";
import { CASES_WIDGETS } from "./widgets";
import { CASES_SOURCE } from "./workspace-source";
import "./todo-paid"; // (a payment todo ticked off pays its case)

/** What Cases registers for other plugins (loaded through plugins/contributions): its cases as a source of the Workspace's pipelines, its widgets. */
workspaceSources.contribute("cases", [CASES_SOURCE]);
workspaceWidgets.contribute("cases", CASES_WIDGETS);
