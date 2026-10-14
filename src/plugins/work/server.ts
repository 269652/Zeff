import { apiPoint } from "@/lib/plugins/api-point";
import { WORK_API } from "./api";

/** What Work registers for other plugins (loaded through plugins/contributions). */
apiPoint.contribute("work", WORK_API);
