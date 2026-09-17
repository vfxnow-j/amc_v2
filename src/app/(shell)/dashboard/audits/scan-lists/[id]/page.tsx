import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shell/page-header";
import { Card, Unset } from "@/components/record/record-card";
import { StatusText } from "@/components/inventory/record-cards";
import { ScanListPanel } from "@/components/inventory/scan-list-panel";
import { canEdit } from "@/lib/auth";
import { getSessionUser } from "@/lib/roles";
import { dayYear } from "@/lib/format";
import { getScanListRecord } from "@/lib/queries/audit-record";

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const list = await getScanListRecord(id);
  return { title: list?.name ?? "Scan list" };
}

/**
 * Inventory → Audits & scan lists → a scan list.
 *
 * A scan list is the loose half of the merge: an audit checks reality against an
 * expected set, a scan list just gathers barcodes and works out what they were
 * afterwards. So this screen has no progress and no exceptions — there is
 * nothing to be wrong against — only what was scanned and what each code turned
 * out to be.
 *
 * Staff can scan into it from here. This was read-only while the scan desk's
 * list mode was the only way a list got made, on the reasoning that a second
 * scan well would give two surfaces for one gather. Once lists could be created
 * from Audits & scan lists, a new list landed on a page that could not take a
 * scan — so the well is here now, on the same primitives and the same ported
 * `addToListByBarcode` as list mode. The bulk change stays on the scan desk.
 */
export default async function ScanListRecordPage({ params }: Params) {
  const { id } = await params;
  const list = await getScanListRecord(id);
  if (!list) notFound();
  const user = await getSessionUser();
  const scanning = user ? canEdit(user.role) : false;

  const unresolved = list.items.filter((item) => item.unitId === null).length;
  const columns =
    "grid grid-cols-[104px_minmax(0,1.4fr)_90px_minmax(0,1fr)_92px] items-center gap-2";

  return (
    <>
      <PageHeader
        eyebrow="Inventory · Scan list"
        title={list.name}
        blurb={
          <>
            {list.items.length === 1
              ? "1 barcode"
              : `${list.items.length} barcodes`}{" "}
            gathered · last scan {dayYear(list.updatedAt)} · started{" "}
            {dayYear(list.createdAt)}
          </>
        }
        actions={
          <Link
            href="/dashboard/audits?tab=scan-lists"
            className="rounded-pill bg-sunken px-4 py-[6px] text-pill text-ink transition-colors hover:bg-row-hover"
          >
            All scan lists
          </Link>
        }
      />

      {scanning ? <ScanListPanel listId={list.id} /> : null}

      {list.description ? (
        <section className="rounded-card bg-panel px-4 py-3 shadow-sm">
          <p className="text-body text-ink-muted">{list.description}</p>
        </section>
      ) : null}

      <Card
        title="Scanned"
        meta={
          unresolved === 0
            ? `all ${list.items.length} matched a unit`
            : `${unresolved} of ${list.items.length} matched nothing`
        }
        className="min-h-0 flex-1"
      >
        {list.items.length === 0 ? (
          <p className="px-4 pb-4 text-body text-balance text-ink-muted">
            Nothing has been scanned into this list. Point a scanner at anything
            and it lands here — a scan list takes whatever is in front of you and
            works out what it was afterwards.
          </p>
        ) : (
          <>
            <div
              className={`${columns} px-4 pb-[6px] text-colhead uppercase text-ink-muted`}
            >
              <span>Barcode</span>
              <span>Asset</span>
              <span>Status</span>
              <span>Location</span>
              <span className="text-right">Scanned</span>
            </div>
            <ul className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-2 pb-3">
              {list.items.map((item) => {
                const cells = (
                  <>
                    <span className="truncate font-bold tabular-nums">
                      {item.barcode}
                    </span>
                    <span className="truncate">
                      {item.assetName ?? (
                        <Unset>Not a registered unit</Unset>
                      )}
                    </span>
                    <span className="truncate">
                      {item.status ? (
                        <StatusText status={item.status} />
                      ) : (
                        <Unset>—</Unset>
                      )}
                    </span>
                    <span className="truncate text-ink-muted">
                      {item.locationName ?? <Unset>Unlocated</Unset>}
                    </span>
                    <span className="text-right tabular-nums text-ink-faint">
                      {dayYear(item.scannedAt)}
                    </span>
                  </>
                );
                const className = `${columns} rounded-row px-2 py-[6px] text-detail`;

                return (
                  <li key={item.id}>
                    {item.unitId ? (
                      <Link
                        href={`/dashboard/units/${item.unitId}`}
                        className={`${className} hover:bg-row-hover`}
                      >
                        {cells}
                      </Link>
                    ) : (
                      <div className={className}>{cells}</div>
                    )}
                  </li>
                );
              })}
            </ul>
            {unresolved > 0 ? (
              <p className="px-4 pb-3 text-detail text-balance text-ink-muted">
                {/* A code that matches nothing is the interesting output of a
                    loose gather: either the label is wrong or the hardware was
                    never registered. */}
                {unresolved} scanned{" "}
                {unresolved === 1 ? "code matches" : "codes match"} no registered
                unit — either the label is wrong or that hardware was never put
                on the books.
              </p>
            ) : null}
          </>
        )}
      </Card>
    </>
  );
}
