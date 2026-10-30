import { collectionProviders } from "@/lib/items/point";
import { keepCollections } from "./collections";

/** What the Keep module registers (loaded through plugins/contributions): Google Keep's notes (until they are a Workspace database) and old note refs as collections. */
collectionProviders.contribute("workspace", keepCollections);
