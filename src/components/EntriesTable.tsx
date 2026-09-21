import Link from "next/link";
import { deleteEntryAction } from "@/app/actions";
import type { EntryWithJob } from "@/lib/entries";
import { formatHours } from "@/lib/format";
import { SubmitButton } from "./SubmitButton";

export function EntriesTable({
  entries,
  showJob = true,
}: {
  entries: EntryWithJob[];
  showJob?: boolean;
}) {
  if (entries.length === 0) {
    return <p className="py-4 text-center text-sm text-zinc-500">No entries.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th>Date</th>
            {showJob && <th>Job</th>}
            <th className="num">Hours</th>
            <th>Description</th>
            <th>Ticket</th>
            <th>By</th>
            <th>Source</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
              <td className="font-mono whitespace-nowrap">{e.date}</td>
              {showJob && (
                <td>
                  <Link href={`/jobs/${e.job.id}`} className="hover:underline">
                    <span className="font-mono whitespace-nowrap">{e.job.number}</span> {e.job.name}
                  </Link>
                </td>
              )}
              <td className="num font-semibold">{formatHours(e.hours)}</td>
              <td className="max-w-md">{e.description}</td>
              <td className="font-mono whitespace-nowrap">{e.ticket ?? ""}</td>
              <td className="whitespace-nowrap">{e.reportedBy}</td>
              <td>
                <span className={`badge badge-${e.source}`}>
                  {e.source}
                </span>
              </td>
              <td className="whitespace-nowrap">
                <div className="flex justify-end gap-1">
                  <Link href={`/entries/${e.id}`} className="btn btn-sm">
                    Edit
                  </Link>
                  <form action={deleteEntryAction}>
                    <input type="hidden" name="id" value={e.id} />
                    <SubmitButton
                      className="btn btn-sm btn-danger"
                      pendingText="…"
                      confirm={`Delete ${formatHours(e.hours)}h on ${e.job.number} (${e.date})?`}
                    >
                      Delete
                    </SubmitButton>
                  </form>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
