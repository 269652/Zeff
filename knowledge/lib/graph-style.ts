/** The entity types' colours and names — for the graph and the page view. Client-safe. */
export const TYPE_STYLE: Record<string, { color: string; label: string }> = {
  person: { color: "#e11d48", label: "Person" },
  team: { color: "#db2777", label: "Team" },
  customer: { color: "#ca8a04", label: "Customer" },
  project: { color: "#ea580c", label: "Project" },
  system: { color: "#2563eb", label: "System" },
  component: { color: "#0891b2", label: "Component" },
  service: { color: "#7c3aed", label: "Service" },
  environment: { color: "#65a30d", label: "Environment" },
  process: { color: "#16a34a", label: "Process" },
  document: { color: "#0d9488", label: "Document" },
  ticket: { color: "#9333ea", label: "Ticket" },
  term: { color: "#64748b", label: "Term" },
};

export const styleOf = (type: string) => TYPE_STYLE[type] ?? { color: "#71717a", label: type };
