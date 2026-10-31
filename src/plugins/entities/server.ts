import { proposalSources } from "@/lib/proposals/point";
import { workspaceSources } from "@/plugins/workspace/source-point";
import { ENTITY_PROPOSALS } from "./proposals";
import { ORGS_SOURCE, PLACES_SOURCE, PROJECTS_SOURCE } from "./workspace-source";

/** What Entities registers for other plugins (loaded through plugins/contributions): organisations, projects and places as sources of the Workspace's pipelines … */
workspaceSources.contribute("entities", [ORGS_SOURCE, PROJECTS_SOURCE, PLACES_SOURCE]);
/** … and what it proposes (the review queue lists them, decide() does them: @/lib/proposals). */
proposalSources.contribute("entities", ENTITY_PROPOSALS);
