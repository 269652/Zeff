/** Small line icons for icon buttons, drawn in the current text color. */
const iconProps = {
  viewBox: "0 0 20 20",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

/** Two overlapping sheets: copy / duplicate. */
export function CopyIcon({ className = "size-4" }: { className?: string }) {
  return (
    <svg {...iconProps} className={className}>
      <rect x="7" y="7" width="9.5" height="9.5" rx="1.75" />
      <path d="M13 4.5v-.25A1.75 1.75 0 0 0 11.25 2.5h-6.5A1.75 1.75 0 0 0 3 4.25v6.5a1.75 1.75 0 0 0 1.75 1.75H5" />
    </svg>
  );
}

/** A bin: delete. */
export function TrashIcon({ className = "size-4" }: { className?: string }) {
  return (
    <svg {...iconProps} className={className}>
      <path d="M3.5 5.5h13M8 5.5V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5M5 5.5l.75 10.25A1.5 1.5 0 0 0 7.25 17.2h5.5a1.5 1.5 0 0 0 1.5-1.45L15 5.5M8.5 8.75v5.5M11.5 8.75v5.5" />
    </svg>
  );
}

/** A chevron pointing right — down once `open`: unfold / fold. */
export function ChevronIcon({ open = false, className = "size-4" }: { open?: boolean; className?: string }) {
  return (
    <svg {...iconProps} className={`${className} transition-transform ${open ? "rotate-90" : ""}`}>
      <path d="m7.5 5 5 5-5 5" />
    </svg>
  );
}

/** Six dots: a handle to drag by. */
export function GripIcon({ className = "size-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden className={className}>
      {[6, 10, 14].flatMap((y) => [7.5, 12.5].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r={1.25} />))}
    </svg>
  );
}

/** Two arrows in a circle: sync. They point clockwise — the way animate-spin turns it. */
export function SyncIcon({ className = "size-4" }: { className?: string }) {
  return (
    <svg {...iconProps} className={className}>
      <path d="M4.5 8.5a5.75 5.75 0 0 1 10.4-2.6M15.5 11.5a5.75 5.75 0 0 1-10.4 2.6" />
      <path d="M15 3v3h-3M5 17v-3h3" />
    </svg>
  );
}

/** A pencil: edit. */
export function PencilIcon({ className = "size-4" }: { className?: string }) {
  return (
    <svg {...iconProps} className={className}>
      <path d="M12.75 4.25 15.75 7.25M4 16l.75-3.25L13.5 4a1.4 1.4 0 0 1 2 0l.5.5a1.4 1.4 0 0 1 0 2L7.25 15.25z" />
    </svg>
  );
}

/** A magnifier: search. */
export function SearchIcon({ className = "size-4" }: { className?: string }) {
  return (
    <svg {...iconProps} className={className}>
      <circle cx="8.75" cy="8.75" r="5.25" />
      <path d="m12.75 12.75 4 4" />
    </svg>
  );
}

/** A paper clip: attach files. */
export function PaperclipIcon({ className = "size-4" }: { className?: string }) {
  return (
    <svg {...iconProps} className={className}>
      <path d="m15.5 9.25-5.6 5.6a3.5 3.5 0 0 1-4.95-4.95l6.2-6.2a2.33 2.33 0 0 1 3.3 3.3l-6.2 6.2a1.17 1.17 0 0 1-1.65-1.65l5.6-5.6" />
    </svg>
  );
}

/** A calendar page: pick a day. */
export function CalendarIcon({ className = "size-4" }: { className?: string }) {
  return (
    <svg {...iconProps} className={className}>
      <rect x="3.25" y="4.5" width="13.5" height="12.25" rx="1.75" />
      <path d="M3.25 8.25h13.5M7 2.75v3.5M13 2.75v3.5" />
    </svg>
  );
}

/** A speech bubble: a note, a comment. */
export function NoteIcon({ className = "size-4" }: { className?: string }) {
  return (
    <svg {...iconProps} className={className}>
      <path d="M4.25 3.5h11.5A1.75 1.75 0 0 1 17.5 5.25v7.5a1.75 1.75 0 0 1-1.75 1.75H9l-3.75 3v-3h-1A1.75 1.75 0 0 1 2.5 12.75v-7.5A1.75 1.75 0 0 1 4.25 3.5Z" />
      <path d="M6 7.5h8M6 10.5h5" />
    </svg>
  );
}

/** Sparkles: let the AI do it. */
export function SparkIcon({ className = "size-4" }: { className?: string }) {
  return (
    <svg {...iconProps} className={className}>
      <path d="M8.5 2.75 9.9 6.6a1.5 1.5 0 0 0 .9.9l3.85 1.4-3.85 1.4a1.5 1.5 0 0 0-.9.9L8.5 15.05 7.1 11.2a1.5 1.5 0 0 0-.9-.9L2.35 8.9 6.2 7.5a1.5 1.5 0 0 0 .9-.9Z" />
      <path d="M15 12.5v4M13 14.5h4" />
    </svg>
  );
}

/** An arrow down: move to the bottom (put off for now). */
export function ToBottomIcon({ className = "size-4" }: { className?: string }) {
  return (
    <svg {...iconProps} className={className}>
      <path d="M10 3.5v13M5 11.5l5 5 5-5" />
    </svg>
  );
}

/** An arrow up: back to the top. */
export function ToTopIcon({ className = "size-4" }: { className?: string }) {
  return (
    <svg {...iconProps} className={className}>
      <path d="M10 16.5v-13M5 8.5l5-5 5 5" />
    </svg>
  );
}

/** A flag: important. */
export function FlagIcon({ className = "size-4", filled = false }: { className?: string; filled?: boolean }) {
  return (
    <svg {...iconProps} className={className} fill={filled ? "currentColor" : "none"}>
      <path d="M4.5 17.5V3.5M4.5 4h9.25l-2 3.5 2 3.5H4.5" />
    </svg>
  );
}
