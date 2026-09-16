import { Card, CardEmpty, Field, Unset } from "@/components/record/record-card";
import { dayYear, moneyExact } from "@/lib/format";
import { getFundingDocuments } from "@/lib/queries/funding";

/**
 * The Funding request record's cards that are not specific to one section.
 *
 * The request sections themselves are laid out in the page, from the one query
 * the whole record is read from; what lives here is reusable chrome — a label
 * grid, a block of prose — and the documents card, which Suspends on its own.
 */

/** A labelled value that shows a faint dash rather than a blank or a zero. */
export function Value({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Field label={label}>
      {value === null || value === undefined || value === "" ? <Unset /> : value}
    </Field>
  );
}

export function moneyOrNull(value: number | null): string | null {
  return value === null ? null : moneyExact(value);
}

export function Prose({ label, text }: { label: string; text: string | null }) {
  if (!text) return null;
  return (
    <div className="px-4 pb-4">
      <p className="mb-[2px] text-micro uppercase text-ink-muted">{label}</p>
      <p className="whitespace-pre-line text-body">{text}</p>
    </div>
  );
}

export function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 px-4 pb-4 sm:grid-cols-4">{children}</div>;
}

/**
 * The saved copies of the form, and the on-demand print.
 *
 * Submitting files a copy, which is what accounting was sent; the print renders
 * the request as it stands now. They drift apart the moment the request is
 * edited after submission, and both are worth having, so both are offered and
 * said apart.
 */
export async function FundingDocumentsCard({ id }: { id: string }) {
  const documents = await getFundingDocuments(id);

  return (
    <Card title="Documents">
      {documents.length === 0 ? (
        <CardEmpty>
          No copy is on file yet. One is saved automatically when the request is
          submitted to accounting.
        </CardEmpty>
      ) : (
        <ul className="flex flex-col gap-px px-2 pb-3">
          {documents.map((document) => (
            <li key={document.id}>
              <a
                href={`/api/documents/${document.id}`}
                target="_blank"
                rel="noopener"
                className="grid grid-cols-[1fr_74px] items-baseline gap-2 rounded-row px-2 py-[6px] text-detail hover:bg-row-hover"
              >
                <span className="truncate">{document.filename}</span>
                <span className="text-right tabular-nums text-ink-faint">
                  {dayYear(document.updatedAt)}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
      <p className="px-4 pb-4 text-detail text-ink-muted">
        <a
          href={`/dashboard/funding/${id}/pdf`}
          target="_blank"
          rel="noopener"
          className="text-accent-text hover:underline"
        >
          Print this request as it stands
        </a>
        {documents.length > 0 ? " — the copy above is what was filed at submission." : "."}
      </p>
    </Card>
  );
}
