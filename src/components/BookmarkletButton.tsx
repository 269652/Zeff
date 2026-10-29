"use client";

import { useEffect, useRef } from "react";
import { useT } from "@/components/I18nProvider";

/**
 * Renders a draggable bookmarklet link. React strips `javascript:` hrefs, so we
 * set the attribute directly on the DOM node after mount.
 */
export function BookmarkletButton({
  href,
  label,
  className = "btn btn-primary",
}: {
  href: string;
  label: string;
  className?: string;
}) {
  const t = useT();
  const ref = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.setAttribute("href", href);
  }, [href]);
  return (
    // eslint-disable-next-line jsx-a11y/anchor-is-valid -- a link to drag into the bookmarks bar; its href is set after mount
    <a
      ref={ref}
      className={className}
      draggable
      onClick={(e) => e.preventDefault()}
      title={t("Drag me to your bookmarks bar")}
    >
      {label}
    </a>
  );
}
