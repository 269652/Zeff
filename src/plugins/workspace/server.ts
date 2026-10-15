import { collectionProviders } from "@/lib/items/point";
import { workspaceCollections } from "./collections";

/** What Workspace registers for other plugins (loaded through plugins/contributions). */
collectionProviders.contribute("workspace", workspaceCollections);
