"use client";

import { useEffect, useRef } from "react";

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
  const ref = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.setAttribute("href", href);
  }, [href]);
  return (
    <a
      ref={ref}
      className={className}
      draggable
      onClick={(e) => e.preventDefault()}
      title="Drag me to your bookmarks bar"
    >
      {label}
    </a>
  );
}
