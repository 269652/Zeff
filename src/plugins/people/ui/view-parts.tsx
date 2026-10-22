"use client";

import { useNoAppData, type PartProps, type ViewAppModule } from "@/plugins/workspace/ui/app-view";
import PeopleView from "./PeopleView";

/** The people app's view, client side: the parts its template is built of. */
const view: ViewAppModule = {
  parts: { "people.view": (p: PartProps) => <PeopleView {...p} /> },
  useAppData: useNoAppData,
};
export default view;
