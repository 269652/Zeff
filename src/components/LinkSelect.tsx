"use client";

import { useRouter } from "next/navigation";

/** A small select whose options are links (e.g. a panel's "by tag / by type"), keeping the scroll position. */
export function LinkSelect({
  value,
  options,
  label,
}: {
  value: string;
  options: { value: string; label: string; href: string }[];
  label: string;
}) {
  const router = useRouter();
  return (
    <select
      aria-label={label}
      className="input w-auto py-0.5 text-xs"
      value={value}
      onChange={(e) => {
        const opt = options.find((o) => o.value === e.target.value);
        if (opt) router.replace(opt.href, { scroll: false });
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
