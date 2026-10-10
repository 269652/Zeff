/** The entity types' colours and names (German) — for the graph and the page view. Client-safe. */
export const TYPE_STYLE: Record<string, { color: string; label: string }> = {
  person: { color: "#e11d48", label: "Person" },
  team: { color: "#db2777", label: "Team" },
  customer: { color: "#ca8a04", label: "Kunde" },
  project: { color: "#ea580c", label: "Projekt" },
  system: { color: "#2563eb", label: "System" },
  component: { color: "#0891b2", label: "Komponente" },
  service: { color: "#7c3aed", label: "Dienst" },
  environment: { color: "#65a30d", label: "Umgebung" },
  process: { color: "#16a34a", label: "Prozess" },
  document: { color: "#0d9488", label: "Dokument" },
  ticket: { color: "#9333ea", label: "Ticket" },
  term: { color: "#64748b", label: "Begriff" },
};

export const styleOf = (type: string) => TYPE_STYLE[type] ?? { color: "#71717a", label: type };
