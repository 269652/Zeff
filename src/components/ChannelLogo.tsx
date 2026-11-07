/**
 * The marks of the channels Zeff reads — Gmail, Outlook, Teams, WhatsApp, Signal, any mailbox, all of them — drawn small and simplified
 * in their colours, to tell them apart at a glance (a tab, a list's line). Named by the channel ("Gmail", "WhatsApp", "E-Mail" …) or
 * its key. Decorative: what it stands for is said beside it or in its label.
 */

const KEYS: Record<string, string> = { gmail: "gmail", outlook: "outlook", teams: "teams", whatsapp: "whatsapp", signal: "signal", "e-mail": "mail", mail: "mail", imap: "mail", all: "all", "": "all" };

/** A channel's name as the key of its mark ("Gmail" → gmail); a mailbox of its own (IMAP) is any mail. */
export const logoKey = (name: string): string => KEYS[name.trim().toLowerCase()] ?? (/gmail/i.test(name) ? "gmail" : "mail");

export function ChannelLogo({ name, className = "size-4" }: { name: string; className?: string }) {
  const key = logoKey(name);
  const svg = (children: React.ReactNode) => (
    <svg viewBox="0 0 24 24" className={`inline-block shrink-0 ${className}`} aria-hidden>
      {children}
    </svg>
  );
  switch (key) {
    case "gmail":
      return svg(
        <>
          <path fill="#4285F4" d="M2 7.2v11.3A1.5 1.5 0 0 0 3.5 20H6.5V10.6z" />
          <path fill="#34A853" d="M17.5 20H20.5a1.5 1.5 0 0 0 1.5-1.5V7.2l-4.5 3.4z" />
          <path fill="#FBBC04" d="M17.5 5.4v5.2L22 7.2V6.1c0-1.4-1.6-2.2-2.7-1.4z" />
          <path fill="#EA4335" d="M6.5 10.6V5.4L12 9.5l5.5-4.1v5.2L12 14.7z" />
          <path fill="#C5221F" d="M2 6.1v1.1l4.5 3.4V5.4L4.7 4.7C3.6 3.9 2 4.7 2 6.1z" />
        </>,
      );
    case "whatsapp":
      return svg(
        <>
          <path fill="#25D366" d="M12 2.6a9.3 9.3 0 0 0-8 14.1L2.7 21.3l4.7-1.2A9.3 9.3 0 1 0 12 2.6z" />
          <path fill="#fff" d="M8.8 7.4c.2-.4.4-.4.7-.4h.5c.2 0 .4 0 .5.4l.8 1.8c.1.2 0 .4-.1.6l-.6.7c-.1.1-.1.3 0 .4.6 1.1 1.5 1.9 2.6 2.5.2.1.3.1.4 0l.7-.8c.2-.2.4-.2.6-.1l1.7.8c.2.1.4.2.4.4 0 .3 0 1.1-.6 1.6-.5.5-1.6.9-3.1.3-1.9-.8-3.6-2.5-4.4-4.3-.6-1.5-.4-2.6.0-3.1z" />
        </>,
      );
    case "outlook":
      return svg(
        <>
          <rect x="2" y="3" width="20" height="18" rx="3" fill="#0A64C8" />
          <ellipse cx="12" cy="12" rx="4.6" ry="5.4" fill="none" stroke="#fff" strokeWidth="2.4" />
        </>,
      );
    case "teams":
      return svg(
        <>
          <rect x="2" y="3" width="20" height="18" rx="3" fill="#5059C9" />
          <path fill="#fff" d="M7 7.5h10v2.4h-3.8V17h-2.4V9.9H7z" />
        </>,
      );
    case "signal":
      return svg(
        <>
          <circle cx="12" cy="12" r="10" fill="#3A76F0" />
          <path fill="#fff" d="M12 6.2a5.8 5.8 0 0 0-5 8.7l-.7 2.8 2.8-.7A5.8 5.8 0 1 0 12 6.2z" />
        </>,
      );
    case "all":
      return svg(<path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" d="M3.5 13.5 6 5h12l2.5 8.5V19a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1zM3.5 13.5h5l1 2h5l1-2h5" />);
    default:
      return svg(
        <>
          <rect x="2.5" y="5" width="19" height="14" rx="2" fill="#71717A" />
          <path fill="none" stroke="#fff" strokeWidth="1.8" strokeLinejoin="round" d="m3.5 6.5 8.5 6.5 8.5-6.5" />
        </>,
      );
  }
}
