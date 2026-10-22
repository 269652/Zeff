"use client";

import { useNoAppData, type PartProps, type ViewAppModule } from "@/plugins/workspace/ui/app-view";
import DebtsView from "./DebtsView";

/** The debts app's view, client side: the parts its template is built of. */
const view: ViewAppModule = {
  parts: { "debts.view": (p: PartProps) => <DebtsView {...p} /> },
  useAppData: useNoAppData,
};
export default view;
