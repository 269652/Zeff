"use client";

import { useNoAppData, type PartProps, type ViewAppModule } from "@/plugins/workspace/ui/app-view";
import DocumentsView from "./DocumentsView";

/** The documents app's view, client side: the parts its template is built of. */
const view: ViewAppModule = {
  parts: { "documents.view": (p: PartProps) => <DocumentsView {...p} /> },
  useAppData: useNoAppData,
};
export default view;
