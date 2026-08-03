import Link from "next/link";
import { redirect } from "next/navigation";
import { Card } from "@/components/record/record-card";
import {
  SettingsDenied,
  SettingsHeader,
} from "@/components/settings/settings-chrome";
import { getSessionUser } from "@/lib/roles";
import { IMPORT_KINDS } from "@/lib/settings/imports";
import { isAdminRole } from "@/lib/settings/pages";

export const metadata = { title: "Import" };

/**
 * Settings → Import.
 *
 * Three spreadsheet loaders, and the warning that belongs in front of all of
 * them: these write straight into live inventory. Every one shows what it would
 * do before it does anything, but the index is where somebody decides which one
 * they meant, and picking the wrong loader is the mistake that is hardest to
 * undo — a rate card run against a retirement sheet reprices nothing and
 * retires nothing, but an asset load run twice creates a second copy of the
 * fleet.
 */
export default async function ImportIndexPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!isAdminRole(user.role))
    return <SettingsDenied id="import" role={user.title} />;

  return (
    <>
      <SettingsHeader id="import" />

      <div className="grid min-h-0 flex-1 items-start gap-3 lg:grid-cols-3">
        {IMPORT_KINDS.map((kind) => (
          <Card key={kind.id} title={kind.label}>
            <div className="flex flex-col gap-3 px-4 pb-4">
              <p className="text-body text-ink-muted">{kind.blurb}</p>
              <details className="rounded-well bg-sunken p-2">
                <summary className="cursor-pointer text-detail text-ink-muted">
                  {kind.columns.length} columns it reads
                </summary>
                <ul className="mt-1 text-detail text-ink-faint">
                  {kind.columns.map((column) => (
                    <li key={column}>
                      <code>{column}</code>
                    </li>
                  ))}
                </ul>
              </details>
              <Link
                href={kind.href}
                className="self-start rounded-pill bg-accent-solid px-4 py-[6px] text-pill text-accent-on-solid transition-colors hover:bg-accent-800"
              >
                Open
              </Link>
            </div>
          </Card>
        ))}
      </div>

      <section className="rounded-card bg-panel p-[14px] shadow-sm">
        <p className="text-body text-balance text-ink-muted">
          Column names are matched literally against the header row, because
          they are the export headers of the system this data came from. A sheet
          whose headings have been tidied up by hand parses to zero rows and
          reads as an empty file rather than a naming mismatch — so check the
          list above before assuming a sheet is bad.
        </p>
      </section>
    </>
  );
}
