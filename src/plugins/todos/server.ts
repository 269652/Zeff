import { apiPoint } from "@/lib/plugins/api-point";
import { workspaceSources } from "@/plugins/workspace/source-point";
import { TODOS_API } from "./api";
import { TODOS_SOURCE } from "./workspace-source";

/** What Todos registers for other plugins (loaded through plugins/contributions). */
apiPoint.contribute("todos", TODOS_API);
/** … and its todos as something the Workspace's databases can join (by ticket). */
workspaceSources.contribute("todos", [TODOS_SOURCE]);
