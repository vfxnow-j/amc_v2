import { Suspense } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { dayYear } from "@/lib/format";
import { UNIT_STATUS_LABEL } from "@/lib/inventory/labels";
import { findUnitByCode } from "@/lib/queries/operate";

export const metadata = { title: "Scan" };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-[2px]">
      <span className="text-micro uppercase text-ink-muted">{label}</span>
      <span className="text-body">{children}</span>
    </div>
  );
}

async function Result({ code }: { code: string }) {
  const unit = await findUnitByCode(code);

  if (!unit) {
    return (
      <section className="rounded-card bg-panel p-4 shadow-sm">
        <p className="text-body text-balance text-ink-muted">
          Nothing matches <span className="font-bold text-ink">{code}</span>.
          That code isn&rsquo;t a barcode or serial on any unit — check it was
          scanned whole, or look it up in{" "}
          <Link
            href={`/dashboard/units?q=${encodeURIComponent(code)}`}
            className="text-accent-text hover:underline"
          >
            Units
          </Link>
          .
        </p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-4 rounded-card bg-panel p-4 shadow-sm">
      <div>
        <p className="text-micro uppercase text-ink-muted">
          {unit.barcode}
          {unit.serialNumber ? ` · ${unit.serialNumber}` : null}
        </p>
        <h2 className="text-card-title">{unit.assetName}</h2>
        {unit.maker ? (
          <p className="text-detail text-ink-muted">{unit.maker}</p>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Status">{UNIT_STATUS_LABEL[unit.status]}</Field>
        <Field label="Location">
          {unit.locationName ?? <span className="text-ink-faint">Unset</span>}
        </Field>
        <Field label="With">
          {unit.holder ? (
            unit.orderId ? (
              <Link
                href={`/dashboard/orders/${unit.orderId}`}
                className="text-accent-text hover:underline"
              >
                {unit.holder} · {unit.orderNumber}
              </Link>
            ) : (
              unit.holder
            )
          ) : (
            <span className="text-ink-faint">On the shelf</span>
          )}
        </Field>
        <Field label="Due back">
          {unit.dueBack ? (
            dayYear(unit.dueBack)
          ) : (
            <span className="text-ink-faint">—</span>
          )}
        </Field>
      </div>

      {unit.workOrder ? (
        <p className="rounded-well bg-accent-tint p-3 text-detail text-accent-on-tint">
          Open work order {unit.workOrder.number} — {unit.workOrder.fault}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Link
          href={`/dashboard/units?q=${encodeURIComponent(unit.barcode)}`}
          className="rounded-pill bg-accent-solid px-4 py-2 text-pill text-accent-on-solid transition-colors hover:bg-accent-800"
        >
          Open in Units
        </Link>
        {unit.orderId ? (
          <Link
            href={`/dashboard/orders/${unit.orderId}`}
            className="rounded-pill bg-sunken px-4 py-2 text-pill text-ink transition-colors hover:bg-row-hover"
          >
            Go to its order
          </Link>
        ) : null}
      </div>
    </section>
  );
}

/**
 * Scan. Renamed from Mobile scan and moved off /dashboard/mobile, 2026-09-09.
 *
 * "Mobile" named the device rather than the job, and the job is the same at a
 * packing desk with a gun as it is on a phone in the aisle. The screen is
 * reached from the dashboard's Scan button rather than the rail, on the owner's
 * call — it is a thing you go and do, not a place in the information
 * architecture.
 *
 * Today it answers one question — "what is this thing, and where should it
 * be?" — and then hands off. Check-out and check-in modes, a scan-list mode and
 * gun ergonomics (carriage-return commit, a queue that never drops a scan, an
 * audible toggle) are the rest of this track; this commit is the rename alone,
 * so nothing about the existing behaviour can regress under it.
 *
 * A plain GET form, so a hardware scanner that types a code and presses Enter
 * works with no JavaScript at all. Codes are matched whole: a fuzzy match here
 * would confidently describe the wrong unit to somebody holding one.
 */
export default async function ScanPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const params = await searchParams;
  const code = params.code?.trim() ?? "";

  return (
    <>
      <PageHeader
        eyebrow="Operate"
        title="Scan"
        blurb="Scan a barcode to see what it is and where it should be"
      />

      <section className="rounded-card bg-panel p-4 shadow-sm">
        <form className="flex items-center gap-2">
          <label className="flex flex-1 items-center gap-2 rounded-well bg-sunken px-[10px] py-2">
            <span className="sr-only">Barcode or serial</span>
            <input
              name="code"
              defaultValue={code}
              autoFocus
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder="Scan or type a barcode"
              className="w-full border-0 bg-transparent text-body text-ink outline-none placeholder:text-ink-faint"
            />
          </label>
          <button
            type="submit"
            className="rounded-pill bg-accent-solid px-4 py-2 text-pill text-accent-on-solid transition-colors hover:bg-accent-800"
          >
            Look up
          </button>
        </form>
      </section>

      {code ? (
        <Suspense
          key={code}
          fallback={
            <div className="h-40 animate-pulse rounded-card bg-panel shadow-sm" />
          }
        >
          <Result code={code} />
        </Suspense>
      ) : (
        <section className="flex flex-1 items-center justify-center rounded-card bg-panel p-[14px] shadow-sm">
          <p className="max-w-sm text-center text-body text-balance text-ink-muted">
            Nothing scanned yet. Point a scanner at any unit barcode, or type a
            serial number — this screen tells you what it is, whose it is and
            when it&rsquo;s due back.
          </p>
        </section>
      )}
    </>
  );
}
