import { apiPoint } from "@/lib/plugins/api-point";
import { reviewSources } from "@/lib/review/point";
import { workspaceSources } from "@/plugins/workspace/source-point";
import { workspaceWidgets } from "@/plugins/workspace/widget-point";
import { TODOS_API } from "./api";
import { TODOS_REVIEW } from "./review";
import { TODOS_SOURCE } from "./workspace-source";
import { TODOS_WIDGETS } from "./widgets";

/** What Todos registers for other plugins (loaded through plugins/contributions). */
apiPoint.contribute("todos", TODOS_API);
/** … and its todos as something the Workspace's databases can join (by ticket). */
workspaceSources.contribute("todos", [TODOS_SOURCE]);
/** … and what it has you confirm (done or not, the actions proposed), for the review queue. */
reviewSources.contribute("todos", TODOS_REVIEW);
/** … and what you got done, as a widget (the weekly review). */
workspaceWidgets.contribute("todos", TODOS_WIDGETS);
