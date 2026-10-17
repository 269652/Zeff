import { collectionProviders } from "@/lib/items/point";
import { workspaceCollections } from "./collections";
import { apiPoint } from "@/lib/plugins/api-point";
import { WORKSPACE_API } from "./api";
import { workspaceSources } from "./source-point";
import { ROUTINES_SOURCE, RUNS_SOURCE } from "./automation-databases";

/** What Workspace registers for other plugins (loaded through plugins/contributions). */
collectionProviders.contribute("workspace", workspaceCollections);
// Its methods for plugins and agents — and offered to the AI as auto actions ("zeff-do").
apiPoint.contribute("workspace", WORKSPACE_API);
// Its automations and their runs as rows (the databases "Automations" and "Automation runs").
workspaceSources.contribute("workspace", [ROUTINES_SOURCE, RUNS_SOURCE]);
