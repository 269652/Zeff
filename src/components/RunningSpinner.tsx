import { useT } from "@/components/I18nProvider";

/** A small turning ring before a todo that's being worked on (a worker, an agent, an action running). */
export function RunningSpinner({ title }: { title?: string }) {
  const t = useT();
  const label = title ?? t("Running");
  return (
    <span
      role="status"
      aria-label={label}
      title={label}
      className="mr-1.5 inline-block size-3.5 shrink-0 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-600 align-[-2px] dark:border-indigo-900 dark:border-t-indigo-400"
    />
  );
}
