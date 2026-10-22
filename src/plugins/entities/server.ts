import { reviewSources } from "@/lib/review/point";
import { workspaceSources } from "@/plugins/workspace/source-point";
import { ENTITIES_REVIEW } from "./review";
import { ORGS_SOURCE, PLACES_SOURCE, PROJECTS_SOURCE } from "./workspace-source";

/** What Entities registers for other plugins (loaded through plugins/contributions): organisations, projects and places as sources of the Workspace's pipelines … */
workspaceSources.contribute("entities", [ORGS_SOURCE, PROJECTS_SOURCE, PLACES_SOURCE]);
/** … and what it has you confirm, for the review queue. */
reviewSources.contribute("entities", ENTITIES_REVIEW);
