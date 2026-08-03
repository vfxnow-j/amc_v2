import Link from "next/link";
import { Card } from "@/components/record/record-card";
import { SettingsHeader } from "@/components/settings/settings-chrome";
import { importKind } from "@/lib/settings/imports";

/**
 * The frame the three spreadsheet loaders share: the runner on the left, the
 * columns it will read on the right.
 *
 * The column list is not reference material tucked in a help page — it is the
 * first thing to check when a sheet produces nothing, because the headers are
 * matched literally. Putting it beside the file picker means the answer is
 * already on screen when that happens.
 */
export function ImportScreen({
  id,
  children,
}: {
  id: string;
  children: React.ReactNode;
}) {
  const kind = importKind(id);
  if (!kind) return null;

  return (
    <>
      <SettingsHeader
        id="import"
        title={`Import · ${kind.label}`}
        blurb={kind.blurb}
        actions={
          <Link
            href="/dashboard/settings/import"
            className="rounded-pill bg-sunken px-3 py-1 text-pill text-ink-muted transition-colors hover:bg-row-hover hover:text-ink"
          >
            Other imports
          </Link>
        }
      />

      <div className="grid min-h-0 flex-1 items-start gap-3 lg:grid-cols-[1fr_minmax(0,320px)]">
        <Card title="Run it" meta="nothing is written until you confirm">
          {children}
        </Card>

        <Card
          title="Columns it reads"
          meta={`${kind.columns.length}, matched literally`}
        >
          <ul className="px-4 pb-4 text-detail text-ink-muted">
            {kind.columns.map((column) => (
              <li
                key={column}
                className={column === kind.key ? "text-ink" : undefined}
              >
                <code>{column}</code>
                {column === kind.key ? (
                  <span className="text-ink-faint"> · required</span>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
