import { collectionProviders } from "@/lib/items/point";
import { workspaceCollections } from "./collections";
import { apiPoint } from "@/lib/plugins/api-point";
import { WORKSPACE_API } from "./api";
import { workspaceWidgets } from "./widget-point";
import { WORKSPACE_WIDGETS } from "./widgets-workspace";

/** What Workspace registers for other plugins (loaded through plugins/contributions). */
collectionProviders.contribute("workspace", workspaceCollections);
// Its methods for plugins and agents — and offered to the AI as auto actions ("zeff-do").
apiPoint.contribute("workspace", WORKSPACE_API);
workspaceWidgets.contribute("workspace", WORKSPACE_WIDGETS);
