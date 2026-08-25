import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ListTable,
  ListTableSkeleton,
  type Column,
} from "@/components/list/list-table";
import { FamilyDetails } from "@/components/inventory/family-details";
import { UngroupButton } from "@/components/inventory/ungroup-button";
import { Card, Field, Unset } from "@/components/record/record-card";
import { PageHeader } from "@/components/shell/page-header";
import { money } from "@/lib/format";
import { getFamily, type RateRange } from "@/lib/queries/families";

type Params = { params: Promise<{ id: string }> };

/** Model · Category · Fleet · Free · Out · Service · Day · Month */
const COLUMNS: Column[] = [
  { key: "name", label: "Model", width: "minmax(0,1.5fr)" },
  { key: "maker", label: "Make & part", width: "minmax(0,1fr)" },
  { key: "category", label: "Category", width: "124px" },
  { key: "fleet", label: "Fleet", width: "58px", align: "right" },
  { key: "available", label: "Free", width: "58px", align: "right" },
  { key: "out", label: "Out", width: "52px", align: "right" },
  { key: "service", label: "Service", width: "62px", align: "right" },
  { key: "daily", label: "Day", width: "76px", align: "right" },
  { key: "monthly", label: "Month", width: "80px", align: "right" },
];

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const family = await getFamily(id);
  return { title: family?.name ?? "Asset" };
}

function rateLabel(range: RateRange): string {
  if (!range) return "—";
  return range.min === range.max
    ? money(range.min)
    : `${money(range.min)} – ${money(range.max)}`;
}

/**
 * Inventory → Assets → the record. One asset, every model of it, one set of
 * numbers.
 *
 * This is the screen the whole family tier exists for. "How many Mac Studios
 * are free" used to mean searching, reading four rows and adding up, and the
 * RTX 5090 was worse because it is filed twice under names two characters
 * apart. The figures at the top are the sum of the models below them — rolled
 * up live, never stored — so the total and the rows can never disagree.
 *
 * Rates stay per model and are shown as a range, because they genuinely differ:
 * a Mac Studio M1 Ultra 1TB is $400 a month and the 4TB is $550. A single
 * headline rate here would be a number the business could not honour.
 */
export default async function FamilyRecordPage({ params }: Params) {
  const { id } = await params;
  const family = await getFamily(id);
  if (!family) notFound();

  const { stock } = family;

  return (
    <>
      <PageHeader
        eyebrow="Inventory · Asset"
        title={family.name}
        blurb={
          <>
            {family.manufacturer ? `${family.manufacturer} · ` : ""}
            {family.models.length}{" "}
            {family.models.length === 1 ? "model" : "models"}
            {family.categoryNames.length > 0
              ? ` · ${family.categoryNames.join(", ")}`
              : ""}
            {family.description ? ` · ${family.description}` : ""}
          </>
        }
        actions={
          <>
            <UngroupButton id={family.id} models={family.models.length} />
            <Link
              href="/dashboard/assets"
              className="rounded-pill bg-sunken px-3 py-1 text-pill text-ink-muted transition-colors hover:bg-row-hover hover:text-ink"
            >
              ← All assets
            </Link>
          </>
        }
      />

      {/* The answer, before any table has to load. */}
      <section className="flex flex-wrap items-center gap-6 rounded-card bg-panel px-4 py-3 shadow-sm">
        <Figure label="Free now" value={stock.available} loud />
        <Figure label="In fleet" value={stock.fleet} />
        <Figure label="Out" value={stock.out} />
        <Figure label="Service" value={stock.service} />
        {stock.reserved > 0 ? (
          <Figure label="Reserved" value={stock.reserved} />
        ) : null}
        <p className="ml-auto max-w-[46ch] text-detail text-balance text-ink-muted">
          {stock.fleet === 0 ? (
            <>
              No units in the fleet across{" "}
              {family.models.length === 1 ? "this model" : "these models"}
              {stock.gone > 0
                ? ` — ${stock.gone} retired or sold, which is not capacity.`
                : "."}
            </>
          ) : (
            <>
              Summed across {family.models.length}{" "}
              {family.models.length === 1 ? "model" : "models"}, counted the same
              way the order builder counts them
              {stock.gone > 0
                ? `. ${stock.gone} more are retired or sold and are not fleet.`
                : "."}
            </>
          )}
        </p>
      </section>

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[1.7fr_1fr]">
        <Suspense fallback={<ListTableSkeleton />}>
          <ListTable
            columns={COLUMNS}
            total={family.models.length}
            empty={
              <>
                No models under this asset yet. Move some in from the grouping
                review, or from a model&rsquo;s own record.
              </>
            }
            rows={family.models.map((model) => ({
              id: model.id,
              href: `/dashboard/assets/${model.id}`,
              cells: {
                name: (
                  <span className="truncate">
                    {model.name}
                    {model.retired ? (
                      <span className="text-ink-faint"> · retired</span>
                    ) : null}
                  </span>
                ),
                maker: model.maker ? (
                  <span className="truncate text-ink-muted">{model.maker}</span>
                ) : (
                  <span className="text-ink-faint">—</span>
                ),
                category: (
                  <span className="truncate text-ink-muted">
                    {model.categoryName}
                  </span>
                ),
                fleet: model.stock.fleet || <span className="text-ink-faint">—</span>,
                available: (
                  <span className={model.stock.available > 0 ? "font-bold" : "text-ink-faint"}>
                    {model.stock.available || "—"}
                  </span>
                ),
                out: model.stock.out || <span className="text-ink-faint">—</span>,
                service: model.stock.service || (
                  <span className="text-ink-faint">—</span>
                ),
                daily:
                  model.dailyRate === null ? (
                    <span className="text-ink-faint">—</span>
                  ) : (
                    money(model.dailyRate)
                  ),
                monthly:
                  model.monthlyRate === null ? (
                    <span className="text-ink-faint">—</span>
                  ) : (
                    money(model.monthlyRate)
                  ),
              },
            }))}
          />
        </Suspense>

        <div className="flex min-h-0 flex-col gap-3">
          <Card title="Rates across the models" meta="they differ, so this is a range">
            <div className="grid grid-cols-2 gap-3 px-4 pb-3">
              <Field label="Day rate">{rateLabel(family.daily)}</Field>
              <Field label="Month rate">{rateLabel(family.monthly)}</Field>
            </div>
            <p className="px-4 pb-4 text-detail text-ink-muted">
              {family.daily === null && family.monthly === null
                ? "None of these models carries a rate, so nothing here can be quoted from the catalogue."
                : "Priced on the model, not here — a single headline rate would be one the business could not honour across all of them."}
            </p>
          </Card>

          <Card title="Details" meta="the only fields this level owns">
            <FamilyDetails
              id={family.id}
              name={family.name}
              manufacturer={family.manufacturer}
              description={family.description}
              notes={family.notes}
            />
          </Card>

          <Card title="Where it came from">
            <div className="grid grid-cols-2 gap-3 px-4 pb-3">
              <Field label="Makes on the models">
                {family.modelMakers.length > 0 ? (
                  family.modelMakers.join(", ")
                ) : (
                  <Unset>None recorded</Unset>
                )}
              </Field>
              <Field label="Categories">
                {family.categoryNames.length > 0 ? (
                  family.categoryNames.join(", ")
                ) : (
                  <Unset />
                )}
              </Field>
            </div>
            <p className="px-4 pb-4 text-detail text-ink-muted">
              {family.modelMakers.length > 1
                ? "These models were bought as different makes — the same product from different suppliers or at different times. That is why the make stays on the model and only the manufacturer sits on the asset."
                : family.modelMakers.length === 1
                  ? "One make recorded across these models. A later purchase from a different supplier will show up here without disturbing anything."
                  : "No make or part number is recorded on any of these models. They came across from the import without one, which is true of most of the fleet."}
            </p>
            <p className="mx-4 mb-4 rounded-well bg-sunken p-2 text-detail text-ink-muted">
              An asset is a container. Every unit, rate and depreciation
              schedule lives on the model it belongs to, so regrouping these
              changes nothing but where they are listed.
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}

function Figure({
  label,
  value,
  loud,
}: {
  label: string;
  value: number;
  loud?: boolean;
}) {
  return (
    <span className="flex flex-col">
      <span className="text-micro uppercase text-ink-muted">{label}</span>
      <span
        className={`tabular-nums ${loud ? "text-kpi" : "text-[20px] font-bold tracking-[-0.02em]"}`}
      >
        {value}
      </span>
    </span>
  );
}
