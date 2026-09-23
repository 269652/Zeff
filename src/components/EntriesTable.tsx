import Link from "next/link";
import { deleteEntryAction } from "@/app/actions";
import type { EntryWithJob } from "@/lib/entries";
import { formatHours } from "@/lib/format";
import { CopyEntryButton } from "./CopyEntryButton";
import { EntryHoursCell } from "./EntryHoursCell";
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
            <th>Type</th>
            <th className="num">Hours</th>
            <th>Description</th>
            <th>Ticket</th>
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
              <td><span className={`badge badge-${e.type}`}>{e.type}</span></td>
              <td className="num font-semibold">
                <EntryHoursCell entryId={e.id} hours={e.hours} />
              </td>
              <td className="max-w-md">
                {e.description}
                {e.tags.length > 0 && (
                  <span className="ml-1 inline-flex flex-wrap gap-1">
                    {e.tags.map((t) => (
                      <span key={t.id} className="badge badge-tag">#{t.name}</span>
                    ))}
                  </span>
                )}
              </td>
              <td className="font-mono whitespace-nowrap">{e.ticket ?? ""}</td>
              <td>
                <span className={`badge badge-${e.source}`}>
                  {e.source}
                </span>
              </td>
              <td className="whitespace-nowrap">
                <div className="flex justify-end gap-1">
                  <CopyEntryButton entryId={e.id} date={e.date} />
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
