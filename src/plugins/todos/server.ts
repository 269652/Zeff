import { apiPoint } from "@/lib/plugins/api-point";
import { TODOS_API } from "./api";

/** What Todos registers for other plugins (loaded through plugins/contributions). */
apiPoint.contribute("todos", TODOS_API);
