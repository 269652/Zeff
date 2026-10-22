import { extensionPoint } from "@/lib/plugin-kit/extension-point";
import type { QueryView } from "./view-types";

/**
 * Views other plugins add to structured questions (views.ts): a plugin contributes its own with
 * `questionViews.contribute("<plugin>", [view])` from its server.ts — offered while it is installed, checked and run like
 * the built-in ones (the timeline's: events by entity, kind, source and date). Server only.
 */
export const questionViews = extensionPoint<QueryView[]>("questions.views");
