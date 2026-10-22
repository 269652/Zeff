import { apiPoint } from "@/lib/plugins/api-point";
import { questionViews } from "@/plugins/questions/view-point";
import { TIMELINE_API } from "./api";
import { TIMELINE_VIEW } from "./question-view";

/**
 * What the Timeline plugin registers for other plugins (loaded through plugins/contributions): its read methods of the plugin
 * API, and its view for structured questions ("Wann zuletzt mit Y gesprochen?").
 */
apiPoint.contribute("timeline", TIMELINE_API);
questionViews.contribute("timeline", [TIMELINE_VIEW]);
