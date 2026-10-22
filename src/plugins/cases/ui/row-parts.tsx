"use client";

import { useNoAppData, type PartProps, type ViewAppModule } from "@/plugins/workspace/ui/app-view";
import CaseView from "./CaseView";

/** A case's own page, client side: the parts its template is built of. */
const page: ViewAppModule = {
  parts: { "case.page": (p: PartProps) => (p.rowId ? <CaseView rowId={p.rowId} /> : null) },
  useAppData: useNoAppData,
};
export default page;
