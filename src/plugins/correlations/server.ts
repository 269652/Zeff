import { workspaceWidgets } from "@/plugins/workspace/widget-point";
import { CORRELATION_WIDGETS } from "./widgets";

/**
 * What Correlations registers: its Workspace widget. The daily series it reads are the kernel's now (lib/series: your Workspace
 * databases, Zeff's own signals — registered in lib/series/register.ts), there for its port too.
 */
workspaceWidgets.contribute("correlations", CORRELATION_WIDGETS);
