import { extensionPoint } from "@/lib/plugin-kit/extension-point";

/**
 * Daily series — one value per day — that the correlations compare: a plugin names what it can count or measure per day (meeting
 * hours, booked hours, messages, spending, a journal's energy) and gives the values for a period. The Correlations plugin reads every
 * installed plugin's series; a plugin adds its own with `correlationSeries.contribute("<plugin>", [provider])`. Server only.
 */

/** number: a measure (hours, a count, energy 1–5); ordinal: a choice's place in its options (Hard = 1 … Great = 5); binary: 0/1 (a tag, a tick). */
export type SeriesKind = "number" | "ordinal" | "binary";

export type SeriesInfo = {
  /** Unique across providers: "<provider>:<what>" ("calendar:meeting-hours", "db:12:p3"). */
  id: string;
  /** In words, with where it is from: "Journal › Energy", "Meeting hours". */
  label: string;
  /** What it is about, as a word for the explanation ("Journal", "Calendar"). */
  group: string;
  kind: SeriesKind;
  /** After a value ("h", "€"). */
  unit?: string;
  /** Ordinal: the names of the steps, lowest first (the value 1 is the first). */
  levels?: string[];
};

/** A series with its values: a day ("YYYY-MM-DD", local) to a number. A day missing is a day without a value (not a 0). */
export type Series = SeriesInfo & { values: Map<string, number> };

export type SeriesRange = { from: string; to: string };

export type SeriesProvider = {
  /** Unique: "<plugin>.<what>". */
  id: string;
  /** Every series it has values for in the period (inclusive days). */
  series: (range: SeriesRange) => Series[] | Promise<Series[]>;
};

export const correlationSeries = extensionPoint<SeriesProvider[]>("correlations.series");
