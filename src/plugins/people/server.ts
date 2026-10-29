import { reviewSources } from "@/lib/review/point";
import { correlationSeries } from "@/plugins/correlations/series-point";
import { workspaceSources } from "@/plugins/workspace/source-point";
import { workspaceWidgets } from "@/plugins/workspace/widget-point";
import { PEOPLE_SERIES } from "./pulse-insights";
import { PEOPLE_REVIEW } from "./review";
import { PEOPLE_WIDGETS } from "./widgets";
import { PEOPLE_FORMULAS } from "./formulas";
import { workspaceFormulaFunctions } from "@/plugins/workspace/formula-point";
import { PEOPLE_SOURCE } from "./workspace-source";
import "./todo-settle"; // (a promise kept when its todo is done)

/** What People registers for other plugins (loaded through plugins/contributions): its profiles as a source of the Workspace's pipelines. */
workspaceSources.contribute("people", [PEOPLE_SOURCE]);
workspaceWidgets.contribute("people", PEOPLE_WIDGETS);
// Its formula functions: Personen(@Freunde), Kreis(@Chris) — and who @Chris or @Familie is for the others' (Schulden(@Freunde)).
workspaceFormulaFunctions.contribute("people", PEOPLE_FORMULAS);
/** … and what it has you confirm, for the review queue. */
reviewSources.contribute("people", PEOPLE_REVIEW);
// The days with the people you are most in touch with, as daily series for the Correlations (a journal's mood with them and without).
correlationSeries.contribute("people", [PEOPLE_SERIES]);
