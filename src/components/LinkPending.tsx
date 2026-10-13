"use client";

import { useLinkStatus } from "next/link";
import { Spinner } from "@/components/Spinner";

/** Inside a <Link>: a small turning ring while the page it goes to loads. */
export function LinkPending({ className = "" }: { className?: string }) {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return <Spinner className={`ml-1.5 inline-block size-3 align-[-1px] opacity-70 ${className}`} />;
}
