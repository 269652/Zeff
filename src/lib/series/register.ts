import { correlationSeries } from "./series-point";
import { SIGNAL_SERIES } from "./series-signals";
import { WORKSPACE_SERIES } from "./series-workspace";

/**
 * The kernel's own daily series (docs/zeff-kernel.md, "The line": data and rights are the kernel's): your Workspace databases' fields
 * and Zeff's own signals (meeting hours, booked hours, messages, todos, spending, first and last activity). Always there, whoever reads
 * them — the built-in Correlations, or its port through `series.read`. Other built-ins add theirs (the calendar's sleep, People's
 * pulse). Loaded with series.ts. Server only.
 */
correlationSeries.contribute("core", [WORKSPACE_SERIES, SIGNAL_SERIES]);
