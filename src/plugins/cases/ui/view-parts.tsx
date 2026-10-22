"use client";

import { useNoAppData, type PartProps, type ViewAppModule } from "@/plugins/workspace/ui/app-view";
import CasesView from "./CasesView";

/** The cases app's view, client side: the parts its template is built of. */
const view: ViewAppModule = {
  parts: { "cases.view": (p: PartProps) => <CasesView {...p} /> },
  useAppData: useNoAppData,
};
export default view;
