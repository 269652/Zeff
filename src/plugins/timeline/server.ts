import { apiPoint } from "@/lib/plugins/api-point";
import { TIMELINE_API } from "./api";

/** What the Timeline plugin registers for other plugins (loaded through plugins/contributions): its read methods of the plugin API. */
apiPoint.contribute("timeline", TIMELINE_API);
