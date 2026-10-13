import { useT } from "@/components/I18nProvider";
import { Spinner } from "@/components/Spinner";

/** A small turning ring before a todo that's being worked on (a worker, an agent, an action running). */
export function RunningSpinner({ title }: { title?: string }) {
  const t = useT();
  const label = title ?? t("Running");
  return (
<Spinner tone="indigo" label={label} className="mr-1.5 inline-block size-3.5 shrink-0 align-[-2px]" />
  );
}
