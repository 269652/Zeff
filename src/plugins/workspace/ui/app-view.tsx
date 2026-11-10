"use client";

import { useT } from "@/components/I18nProvider";
import { lazy, Suspense, type ComponentType, type LazyExoticComponent, type ReactNode } from "react";
import type { DatabaseData } from "../actions";
import type { Row, View } from "../model";
import { viewAppMeta } from "../view-apps";
import type { CellCtx } from "./cells";

/** What an app's view gets: the database, its rows (filtered, sorted as the view says), opening a row, reading again — and changing rows. */
export type AppViewProps = {
  view: View;
  data: DatabaseData;
  rows: Row[];
  openRow: (id: number) => void;
  reload: () => void;
  /** The toolbar's "New" taken over while the app is shown (its own form for a new row); null: given back. */
  onNew?: (fn: (() => void) | null) => void;
  /** The cells (shown and edited as in a table). */
  ctx?: CellCtx;
  /** What a view's buttons do to rows. */
  rowOps?: RowOps;
};

export type RowOps = {
  /** A new row; with a title it is complete and isn't opened to be filled in. */
  add: (cells: Record<string, unknown>, title?: string) => Promise<number | null>;
  remove: (id: number) => Promise<void> | void;
  duplicate: (id: number) => Promise<void> | void;
  hide: (id: number) => void;
};

/** What a part of an app's view gets: the view's props, its attributes from the template, the view's state, the app's data. */
export type PartProps = AppViewProps & {
  attrs: Record<string, string>;
  state: Record<string, string>;
  setState: (name: string, value: string) => void;
  app: Record<string, unknown>;
  reloadApp: () => void;
  /** The row the part stands in (a list's item, <selected>) — null: none. */
  rowId: number | null;
  children?: ReactNode;
};

/** What an app's own button action gets. */
export type ActionEnv = { props: AppViewProps; state: Record<string, string>; setState: (name: string, value: string) => void; app: Record<string, unknown>; reloadApp: () => void; rowId: number | null; attrs: Record<string, string>; /** The texts in the language shown. */ t: import("@/lib/i18n/shared").T };

/** An app's view, client side: its parts (components by name), the data its template reads as app.* (a hook), its own actions. */
export type ViewAppModule = {
  parts: Record<string, ComponentType<PartProps>>;
  useAppData: (props: AppViewProps, state: Record<string, string>) => { data: Record<string, unknown>; reload: () => void };
  actions?: Record<string, (env: ActionEnv) => void>;
  /** The toolbar's New taken over while the app is shown (the people's name field, the calendar's new event). */
  onNew?: (env: ActionEnv) => void;
};

const NO_DATA = { data: {}, reload: () => {} };
/** An app (or a view of any table) that loads nothing of its own. */
export const useNoAppData = (): { data: Record<string, unknown>; reload: () => void } => NO_DATA;

/** The apps' views, by id — each its plugin's (loaded when shown). "template": a view of any table, built from its template alone. */
const MODULES: Record<string, () => Promise<ViewAppModule>> = {
  template: async () => ({ parts: {}, useAppData: useNoAppData }),
  mail: () => import("@/plugins/mail-client/ui/view-parts").then((m) => m.MAIL),
  chat: () => import("@/plugins/mail-client/ui/view-parts").then((m) => m.CHAT),
  inbox: () => import("@/plugins/mail-client/ui/view-parts").then((m) => m.INBOX),
  people: () => import("@/plugins/people/ui/view-parts").then((m) => m.default),
  calendar: () => import("@/plugins/calendar/ui/view-parts").then((m) => m.default),
  documents: () => import("@/plugins/documents/ui/view-parts").then((m) => m.default),
  cases: () => import("@/plugins/cases/ui/view-parts").then((m) => m.default),
  debts: () => import("@/plugins/finances/ui/view-parts").then((m) => m.default),
  agenda: () => import("@/plugins/agenda/ui/view-parts").then((m) => m.default),
  learn: () => import("@/plugins/learn/ui/view-parts").then((m) => m.default),
};

type HostProps = AppViewProps & { src: string; onErrors?: (errors: { line: number; message: string }[]) => void };
const VIEWS: Record<string, LazyExoticComponent<ComponentType<HostProps>>> = Object.fromEntries(
  Object.entries(MODULES).map(([app, load]) => [
    app,
    lazy(async () => {
      const [module, { TemplateView }] = await Promise.all([load(), import("./view-template")]);
      const meta = viewAppMeta(app)!;
      return { default: (p: HostProps) => <TemplateView {...p} module={module} meta={meta} /> };
    }),
  ]),
);

/** Whether a view is an app's view that can be shown here (its plugin installed; "template" always). */
export const appAvailable = (data: DatabaseData, view: View): boolean => !!view.app && !!VIEWS[view.app] && (view.app === "template" || !!data.extras?.appViews?.some((a) => a.id === view.app));

/** An app's view of the database drawn from its template (`src`: one being written; else the view's own, else the app's default) — or, its app not there (its plugin not installed), the fallback (a table). */
export function AppViewHost({ fallback, src, onErrors, ...props }: AppViewProps & { fallback: ReactNode; src?: string; onErrors?: HostProps["onErrors"] }) {
  const t = useT();
  const View = props.view.app ? VIEWS[props.view.app] : undefined;
  if (!View || !appAvailable(props.data, props.view)) return <>{fallback}</>;
  const template = src ?? props.view.template ?? viewAppMeta(props.view.app!)?.defaultTemplate(t) ?? "";
  return (
    <Suspense fallback={<p className="text-sm text-zinc-400">…</p>}>
      <View {...props} src={template} onErrors={onErrors} />
    </Suspense>
  );
}
