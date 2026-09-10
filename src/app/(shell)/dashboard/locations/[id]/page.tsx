import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shell/page-header";
import {
  Card,
  CardSkeleton,
  Field,
  Unset,
} from "@/components/record/record-card";
import { Tally } from "@/components/inventory/record-cards";
import {
  LocationAssetsCard,
  LocationInboundCard,
  LocationTransfersCard,
  LocationUnitsCard,
} from "@/components/inventory/location-record-cards";
import { dayYear } from "@/lib/format";
import { getLocationHeader } from "@/lib/queries/location-record";

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const header = await getLocationHeader(id);
  return { title: header?.name ?? "Location" };
}

/**
 * Inventory → Locations → the record.
 *
 * New in v2, and the piece the locations list was missing: the list could tell
 * you a warehouse holds 397 free units and then had nowhere to send you, so a
 * row that read "0 free" — the one row worth acting on — was a dead end. This is
 * where that row leads.
 *
 * Read-only. Moving a unit between locations is a transfer, and a transfer is
 * written where the unit is scanned, not from the shelf's own screen — a second
 * place to move stock would drift from the movement log the moment either
 * changed. Same reasoning as the unit record.
 */
export default async function LocationRecordPage({ params }: Params) {
  const { id } = await params;
  const location = await getLocationHeader(id);
  if (!location) notFound();

  const { tally } = location;
  const gone = tally.retired + tally.sold;

  return (
    <>
      <PageHeader
        eyebrow="Inventory · Location"
        title={location.name}
        blurb={
          <>
            {location.parent ? (
              <>
                Within{" "}
                <Link
                  href={`/dashboard/locations/${location.parent.id}`}
                  className="text-accent-text hover:underline"
                >
                  {location.parent.name}
                </Link>{" "}
                ·{" "}
              </>
            ) : null}
            {location.address ?? "no address on file"} · on the books since{" "}
            {dayYear(location.createdAt)}
          </>
        }
        actions={
          tally.inFleet > 0 ? (
            <Link
              href={`/dashboard/units?location=${location.id}`}
              className="rounded-pill bg-accent-solid px-4 py-[6px] text-pill text-accent-on-solid transition-colors hover:bg-accent-800"
            >
              Its units
            </Link>
          ) : null
        }
      />

      <Stock tally={tally} gone={gone} />

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[1.4fr_1fr_1fr]">
        <div className="flex min-h-0 flex-col gap-3">
          <Suspense fallback={<CardSkeleton title="On the shelf" rows={12} />}>
            <LocationUnitsCard id={id} gone={gone} />
          </Suspense>
        </div>

        <div className="flex min-h-0 flex-col gap-3">
          <Suspense fallback={<CardSkeleton title="What is here" rows={12} />}>
            <LocationAssetsCard id={id} />
          </Suspense>
        </div>

        <div className="flex min-h-0 flex-col gap-3">
          <Detail location={location} />
          <Suspense fallback={<CardSkeleton title="Moves" rows={4} />}>
            <LocationTransfersCard id={id} name={location.name} />
          </Suspense>
          <Suspense fallback={<CardSkeleton title="Shipping here" rows={4} />}>
            <LocationInboundCard id={id} />
          </Suspense>
        </div>
      </div>
    </>
  );
}

type Location = NonNullable<Awaited<ReturnType<typeof getLocationHeader>>>;

/** Only the halves that are non-zero: "0 retired, 1 sold" reads as an error. */
function goneClause(tally: Location["tally"]) {
  const parts: string[] = [];
  if (tally.retired > 0) parts.push(`${tally.retired} retired`);
  if (tally.sold > 0) parts.push(`${tally.sold} sold`);
  return parts.join(" and ");
}

/**
 * The shelf in five numbers, above every Suspense boundary.
 *
 * Four of them are the four the locations list shows for this row, from the same
 * `tallyUnits` — a record that disagreed with the list it was opened from would
 * be worse than no record. Reserved is the fifth and is shown only here, which
 * is why in fleet can exceed free + out + service: an earmarked unit is neither
 * free nor gone, and leaving it out of the strip would make the row look like it
 * had lost units.
 */
function Stock({ tally, gone }: { tally: Location["tally"]; gone: number }) {
  return (
    <section className="flex items-center gap-3 rounded-card bg-panel px-4 py-3 shadow-sm">
      <Tally label="In fleet" value={tally.inFleet} />
      <Tally label="Free" value={tally.free} accent={tally.free === 0} />
      <Tally label="Out" value={tally.out} />
      <Tally label="Reserved" value={tally.reserved} />
      <Tally label="Service" value={tally.service} />
      <p className="ml-auto max-w-sm text-right text-detail text-balance text-ink-muted">
        {tally.total === 0
          ? "Nothing is filed at this location at all"
          : tally.inFleet === 0
            ? `Nothing here can earn — all ${tally.total} units filed here are retired or sold`
            : `${tally.inFleet} of ${tally.total} units filed here can still earn${
                gone > 0 ? ` · ${goneClause(tally)}, still filed here` : ""
              }`}
      </p>
    </section>
  );
}

/**
 * The location itself: where it is, what it sits inside, what sits inside it,
 * and the tax rate an order picked up here is charged at.
 *
 * A rate of exactly zero is a decision somebody recorded and reads as "no tax
 * charged"; a location nobody has set a rate on reads as unset. The two are not
 * the same claim, and an order priced against the second is priced against
 * nothing.
 */
function Detail({ location }: { location: Location }) {
  return (
    <Card title="Detail">
      <div className="grid grid-cols-2 gap-3 px-4 pb-4">
        <Field label="Address">
          {location.address ?? <Unset>None on file</Unset>}
        </Field>
        <Field label="Within">
          {location.parent ? (
            <Link
              href={`/dashboard/locations/${location.parent.id}`}
              className="text-accent-text hover:underline"
            >
              {location.parent.name}
            </Link>
          ) : (
            <Unset>Top level</Unset>
          )}
        </Field>
        <Field label="Tax">
          {location.taxRate === null ? (
            <Unset>No rate set</Unset>
          ) : (
            <span className="tabular-nums">
              {(location.taxRate * 100).toFixed(2)}%
              {location.taxLabel ? (
                <span className="text-ink-faint"> · {location.taxLabel}</span>
              ) : location.taxRate === 0 ? (
                <span className="text-ink-faint"> · charges no tax</span>
              ) : null}
            </span>
          )}
        </Field>
        <Field label="Holds">
          {location.children.length === 0 ? (
            <Unset>No sub-locations</Unset>
          ) : (
            `${location.children.length} sub-${
              location.children.length === 1 ? "location" : "locations"
            }`
          )}
        </Field>
      </div>

      {location.children.length > 0 ? (
        <ul className="flex flex-col gap-px px-2 pb-3">
          {location.children.map((child) => (
            <li key={child.id}>
              <Link
                href={`/dashboard/locations/${child.id}`}
                className="grid grid-cols-[minmax(0,1fr)_56px_56px] items-center gap-2 rounded-row px-2 py-[6px] text-detail hover:bg-row-hover"
              >
                <span className="truncate font-bold">{child.name}</span>
                <span className="text-right tabular-nums text-ink-muted">
                  {child.inFleet}
                </span>
                <span
                  className={`text-right tabular-nums ${
                    child.inFleet > 0 && child.free === 0
                      ? "font-bold text-accent-text"
                      : "text-ink-muted"
                  }`}
                >
                  {child.free}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      {location.children.length > 0 ? (
        <p className="px-4 pb-3 text-detail text-ink-muted">
          {/* Said plainly because the numbers above deliberately don't roll up:
              the locations list counts every shelf on its own row, and a record
              that summed its children would report a bigger warehouse than the
              list does under the same name. */}
          In fleet and free, per sub-location. The counts at the top of this
          screen are this location&rsquo;s own units and do not include them.
        </p>
      ) : null}

      {location.description ? (
        <p className="mx-4 mb-4 whitespace-pre-line rounded-well bg-sunken p-2 text-detail text-ink-muted">
          {location.description}
        </p>
      ) : null}
    </Card>
  );
}
