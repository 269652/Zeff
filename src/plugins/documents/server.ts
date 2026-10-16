import { workspaceSources } from "@/plugins/workspace/source-point";
import { DOCUMENTS_SOURCE } from "./workspace-source";

/** What Documents registers for other plugins (loaded through plugins/contributions): the documents as a source of the Workspace's pipelines. */
workspaceSources.contribute("documents", [DOCUMENTS_SOURCE]);
