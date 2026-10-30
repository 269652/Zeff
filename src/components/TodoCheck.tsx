"use client";

/**
 * A todo's checkbox — the one control that ticks a todo wherever it is (a list in a page, Today, a widget, a board, a card's checklist).
 * `className` is its look there (default: the page's list); `onChange` gets whether it is ticked now. Not editable text in an editor.
 */
export function TodoCheck({ checked, onChange, disabled, label, title, className = "ws-todo-check" }: { checked?: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string; title?: string; className?: string }) {
  return <input type="checkbox" className={className} checked={checked} disabled={disabled} title={title} onChange={(e) => onChange(e.target.checked)} aria-label={label} contentEditable={false} />;
}
