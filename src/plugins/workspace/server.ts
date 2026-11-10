import { collectionProviders } from "@/lib/items/point";
import { workspaceCollections } from "./collections";
import { apiPoint } from "@/lib/plugins/api-point";
import { WORKSPACE_API } from "./api";
import "./routine-reports"; // (an agent's reports become final when its todo is ticked off)
import "./routine-agent"; // (an agent routine's permissions: guards and the tools approved for its worker)
import { workspaceWidgets } from "./widget-point";
import { workspaceMetrics } from "./metric-point";
import fs from "node:fs";
import path from "node:path";
import { isEnabled, scanPlugins } from "@/lib/ext/registry";
import { workspacePackages } from "./packages-point";
import type { WorkspacePackage } from "./packages";
import { CORE_METRICS } from "./metrics-core";
import { listOutputs, getOutput } from "./widget-outputs";
import type { MetricProvider } from "./metric-point";

/** The numbers widgets published (zeff.publish) as Kennzahlen: in formulas (kennzahl("name")), on the Kennzahlen page, in Today. */
function widgetOutputMetrics(): MetricProvider[] {
  try {
    return listOutputs({ values: false })
      .filter((o) => o.kind === "number")
      .map((o) => ({
        label: o.label,
        unit: o.unit,
        what: o.widget ? `Published by the widget „${o.widget}“` : "Published by a widget",
        read: () => {
          const v = getOutput(o.key)?.value;
          return typeof v === "number" && Number.isFinite(v) ? v : null;
        },
        ...(o.pageId ? { href: () => `/workspace/${o.pageId}` } : {}),
      }));
  } catch {
    return [];
  }
}
import { dayListMetrics } from "./day-lists";
import { OVERVIEW_METRICS } from "./metrics-overview";
import { METRICS_WIDGET } from "./widgets-metrics";
import "./metrics"; // (kennzahl() in formulas reads the Kennzahlen)
import { WORKSPACE_WIDGETS } from "./widgets-workspace";
import { OVERVIEW_WIDGETS } from "./widgets-overview";
import { workspaceSources } from "./source-point";
import { workspaceFieldTypes } from "./field-point";
import { CORE_FIELD_TYPES } from "./field-types";
import { ROUTINES_SOURCE, RUNS_SOURCE } from "./automation-databases";
import { TASKS_SOURCE } from "./task-source";
import { onTodoDone } from "@/lib/todos/done-hooks";
import { blockTodoDone } from "./task-lists";
import { todoDone } from "./todo-engine";

/** What Workspace registers for other plugins (loaded through plugins/contributions). */
collectionProviders.contribute("workspace", workspaceCollections);
// Its methods for plugins and agents — and offered to the AI as auto actions ("zeff-do").
apiPoint.contribute("workspace", WORKSPACE_API);
workspaceWidgets.contribute("workspace", [...WORKSPACE_WIDGETS, ...OVERVIEW_WIDGETS, METRICS_WIDGET]);
// Zeff's own numbers as Kennzahlen: the hours booked, the todos, the mails, the meetings.
// (With each day list's: how much of it was done, what is open today — day-lists.ts.)
workspaceMetrics.contribute("workspace", () => [...CORE_METRICS, ...OVERVIEW_METRICS, ...dayListMetrics(), ...widgetOutputMetrics()]);
// Its automations and their runs as rows (the databases "Automations" and "Automation runs").
workspaceSources.contribute("workspace", [ROUTINES_SOURCE, RUNS_SOURCE, TASKS_SOURCE]);
// A todo closed in the engine ticks the row or the list item it came from.
onTodoDone((id) => (todoDone(id), blockTodoDone(id)));
workspaceFieldTypes.contribute("workspace", CORE_FIELD_TYPES);

// The Workspace apps external plugins bring (contributes.workspacePackages: package files in the plugin's folder) — of the plugins
// switched on, read when the templates are listed.
workspacePackages.contribute("ext", () => {
  try {
    const out: WorkspacePackage[] = [];
    for (const p of scanPlugins().plugins) {
      if (!isEnabled(p.id)) continue;
      for (const file of p.manifest.contributes.workspacePackages ?? []) {
        const full = path.resolve(p.dir, file);
        if (!full.startsWith(path.resolve(p.dir) + path.sep) || !fs.existsSync(full)) continue;
        const pkg = JSON.parse(fs.readFileSync(full, "utf8")) as WorkspacePackage;
        if (pkg?.format === 1 && Array.isArray(pkg.items)) out.push({ ...pkg, description: pkg.description ?? `From the plugin „${p.manifest.name}“` });
      }
    }
    return out;
  } catch {
    return [];
  }
});
