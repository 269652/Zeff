/** An error next to the control that caused it — red in both themes, announced to screen readers when it appears. Give it an `id` and name it in the control's aria-describedby (see Field). */
export function FormError({ children, className = "text-sm", as: Tag = "span", id }: { children: React.ReactNode; className?: string; as?: "span" | "p" | "div"; id?: string }) {
  return (
    <Tag id={id} role="alert" className={`text-red-700 dark:text-red-400 ${className}`}>
      {children}
    </Tag>
  );
}
