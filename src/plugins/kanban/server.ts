import { apiPoint } from "@/lib/plugins/api-point";
import { KANBAN_API } from "./api";

/** What Kanban registers for other plugins (loaded through plugins/contributions). */
apiPoint.contribute("kanban", KANBAN_API);
