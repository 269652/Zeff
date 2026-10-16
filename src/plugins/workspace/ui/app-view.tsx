"use client";

import { lazy, Suspense, type ComponentType, type LazyExoticComponent, type ReactNode } from "react";
import type { DatabaseData } from "../actions";
import type { Row, View } from "../model";

/** What an app's view gets: the database, its rows (filtered, sorted as the view says), opening a row, reading again. */
export type AppViewProps = { view: View; data: DatabaseData; rows: Row[]; openRow: (id: number) => void; reload: () => void };

/** The apps' views, by id — each its plugin's (loaded when shown). */
const APPS: Record<string, LazyExoticComponent<ComponentType<AppViewProps>>> = {
  mail: lazy(() => import("@/plugins/mail-client/ui/MailView")),
  chat: lazy(() => import("@/plugins/mail-client/ui/ChatView")),
  inbox: lazy(() => import("@/plugins/mail-client/ui/InboxView")),
  people: lazy(() => import("@/plugins/people/ui/PeopleView")),
  calendar: lazy(() => import("@/plugins/calendar/ui/CalendarView")),
};

/** An app's view of the database — or, its app not there (its plugin not installed), the fallback (a table). */
export function AppViewHost({ fallback, ...props }: AppViewProps & { fallback: ReactNode }) {
  const App = props.view.app ? APPS[props.view.app] : undefined;
  const available = props.data.extras?.appViews?.some((a) => a.id === props.view.app);
  if (!App || !available) return <>{fallback}</>;
  return (
    <Suspense fallback={<p className="text-sm text-zinc-400">…</p>}>
      <App {...props} />
    </Suspense>
  );
}
