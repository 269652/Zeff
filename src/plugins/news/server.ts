import { workspaceSources } from "@/plugins/workspace/source-point";
import { NEWS_SOURCE } from "./workspace-source";

/** What News registers for other plugins (loaded through plugins/contributions): the news you kept as a source of the Workspace's pipelines. */
workspaceSources.contribute("news", [NEWS_SOURCE]);
