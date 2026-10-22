"use client";

import { useNoAppData, type PartProps, type ViewAppModule } from "@/plugins/workspace/ui/app-view";
import PersonView from "./PersonView";

/** A person's own page, client side: the parts its template is built of. */
const page: ViewAppModule = {
  parts: { "person.page": (p: PartProps) => (p.rowId ? <PersonView rowId={p.rowId} /> : null) },
  useAppData: useNoAppData,
};
export default page;
