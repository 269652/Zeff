/**
 * What to tell of sources that aren't well, newly (client-safe, pure): one of them — its own notice with "Sync now"; several at
 * once — ONE notice naming them with the details a click away (three red toasts stacked took half a phone's screen).
 */
export type SourceNotice = { text: string; action: { kind: "sync"; step: string } | { kind: "details" } };

export function sourceToasts(fresh: { key: string; title: string; body: string; step: string }[], t: (s: string, v?: Record<string, string | number>) => string): SourceNotice[] {
  if (!fresh.length) return [];
  if (fresh.length === 1) return [{ text: `${fresh[0].title} — ${fresh[0].body}`, action: { kind: "sync", step: fresh[0].step } }];
  return [{ text: t("{n} sources need attention: {names}", { n: fresh.length, names: fresh.map((a) => a.title).join(", ") }), action: { kind: "details" } }];
}
