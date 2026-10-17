import { workspaceWidgets } from "@/plugins/workspace/widget-point";
import { MAIL_WIDGETS } from "./widgets";

/** What Mail & Chat registers for other plugins (loaded through plugins/contributions): its widgets for the Workspace. */
workspaceWidgets.contribute("mail-client", MAIL_WIDGETS);
