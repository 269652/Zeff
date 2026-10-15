import { t } from "@/lib/i18n/server";

/** The unread marker: a coloured dot plus the word for screen readers (colour alone isn't enough). Server component. */
export function UnreadDot({ className = "bg-indigo-500" }: { className?: string }) {
  return (
    <>
      <span className={`size-2 shrink-0 rounded-full ${className}`} aria-hidden />
      <span className="sr-only">{t("unread")}</span>
    </>
  );
}

/** The empty slot an unread dot would take (keeps the rows aligned). */
export function UnreadDotSlot() {
  return <span className="mt-1.5 size-2 shrink-0" aria-hidden />;
}
