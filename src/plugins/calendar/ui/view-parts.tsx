"use client";

import { useNoAppData, type PartProps, type ViewAppModule } from "@/plugins/workspace/ui/app-view";
import CalendarView from "./CalendarView";

/** The calendar app's view, client side: the parts its template is built of. */
const view: ViewAppModule = {
  parts: { "calendar.view": (p: PartProps) => <CalendarView {...p} /> },
  useAppData: useNoAppData,
};
export default view;
