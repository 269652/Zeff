import { reviewSources } from "@/lib/review/point";
import { proposalSources } from "@/lib/proposals/point";
import { PEOPLE_PROPOSALS } from "./proposals";
import { correlationSeries } from "@/plugins/correlations/series-point";
import { workspaceSources } from "@/plugins/workspace/source-point";
import { workspaceWidgets } from "@/plugins/workspace/widget-point";
import { rowBadgeSources } from "@/plugins/workspace/row-badge-point";
import { PEOPLE_ROW_BADGES } from "./badges";
import { PEOPLE_SERIES } from "./pulse-insights";
import { PEOPLE_REVIEW } from "./review";
import { PEOPLE_WIDGETS } from "./widgets";
import { PERSON_WIDGETS } from "./widgets-person";
import { PERSON_DETAIL_WIDGETS } from "./widgets-person-more";
import { PEOPLE_FORMULAS } from "./formulas";
import { workspaceFormulaFunctions } from "@/plugins/workspace/formula-point";
import { PEOPLE_SOURCE } from "./workspace-source";
import "./todo-settle"; // (a promise kept when its todo is done)

/** What People registers for other plugins (loaded through plugins/contributions): its profiles as a source of the Workspace's pipelines. */
workspaceSources.contribute("people", [PEOPLE_SOURCE]);
workspaceWidgets.contribute("people", [...PEOPLE_WIDGETS, ...PERSON_WIDGETS, ...PERSON_DETAIL_WIDGETS]);
// A person's row in the tree: their open todos, overdue promises and unread messages as its badge (Personen adds them up).
rowBadgeSources.contribute("people", [PEOPLE_ROW_BADGES]);
// Its formula functions: Personen(@Freunde), Kreis(@Chris) — and who @Chris or @Familie is for the others' (Schulden(@Freunde)).
workspaceFormulaFunctions.contribute("people", PEOPLE_FORMULAS);
/** … and what it has you confirm, for the review queue. */
reviewSources.contribute("people", PEOPLE_REVIEW);
// … its proposals (the names that may be one person), decided through the one store's decide() (@/lib/proposals).
proposalSources.contribute("people", PEOPLE_PROPOSALS);
// The days with the people you are most in touch with, as daily series for the Correlations (a journal's mood with them and without).
correlationSeries.contribute("people", [PEOPLE_SERIES]);
