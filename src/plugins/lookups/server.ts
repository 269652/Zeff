import { workspaceLookups } from "@/plugins/workspace/lookup-point";
import { OPEN_SOURCES } from "./open-sources";
import { TMDB_SOURCES } from "./tmdb";

/** What Lookups registers (loaded through plugins/contributions). */
workspaceLookups.contribute("lookups", [...TMDB_SOURCES, ...OPEN_SOURCES]);
