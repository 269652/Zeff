import { t } from "@/lib/i18n/server";
import { appNavProviders } from "@/plugins/workspace/app-nav-point";
import { workspaceSources } from "@/plugins/workspace/source-point";
import { docNav, factsOf } from "./nav";
import { DOCUMENTS_SOURCE } from "./workspace-source";

/** What Documents registers for other plugins (loaded through plugins/contributions): the documents as a source of the Workspace's pipelines. */
workspaceSources.contribute("documents", [DOCUMENTS_SOURCE]);
// Its view's sidebar (the inbox, all, by type …) — in the Workspace tree when the view says so.
appNavProviders.contribute("documents", [{ app: "documents", entries: (rows) => docNav(rows.map((r) => factsOf(r.cells)), (s) => t(s)) }]);
