/** An error next to the control that caused it — red in both themes, announced to screen readers when it appears. */
export function FormError({ children, className = "text-sm", as: Tag = "span" }: { children: React.ReactNode; className?: string; as?: "span" | "p" | "div" }) {
  return (
    <Tag role="alert" className={`text-red-600 dark:text-red-400 ${className}`}>
      {children}
    </Tag>
  );
}
