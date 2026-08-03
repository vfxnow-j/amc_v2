import { Suspense } from "react";
import { redirect } from "next/navigation";
import { FilterTabs, type TabOption } from "@/components/list/filter-tabs";
import {
  ListTable,
  ListTableSkeleton,
  type Column,
} from "@/components/list/list-table";
import { Card, CardEmpty } from "@/components/record/record-card";
import { CloudProductForm } from "@/components/settings/cloud-product-form";
import { SettingsHeader } from "@/components/settings/settings-chrome";
import { CLOUD_CATEGORIES, cloudCategoryLabel } from "@/lib/cloud-products";
import { moneyExact } from "@/lib/format";
import { getCloudProductRows } from "@/lib/queries/settings";
import { getSessionUser } from "@/lib/roles";
import { isAdminRole } from "@/lib/settings/pages";

export const metadata = { title: "Cloud pricing" };

const COLUMNS: Column[] = [
  { key: "name", label: "Product", width: "minmax(0,1fr)" },
  { key: "group", label: "Category", width: "150px" },
  { key: "hour", label: "Cost / hr", width: "88px", align: "right" },
  { key: "day", label: "Cost / day", width: "88px", align: "right" },
  { key: "month", label: "Cost / mo", width: "92px", align: "right" },
  { key: "margin", label: "Margin", width: "72px", align: "right" },
  { key: "sell", label: "Sell / mo", width: "104px", align: "right" },
  { key: "state", label: "State", width: "88px" },
];

/**
 * Settings → Cloud pricing.
 *
 * The cost basis and margin behind every line of a cloud order. Sixty-two
 * products across eight categories, which is why the category strip is here
 * rather than eight stacked tables the way v1 rendered it — one dense table you
 * can compare down beats eight you have to scroll between.
 *
 * The "Sell / mo" column marks a derived price with "·d" and the footer says
 * how many, the same convention the Cloud services list uses. A price nobody
 * set and a price somebody set are different facts, and a table that showed
 * both as plain numbers would quietly turn a margin calculation into a decision.
 */
export default async function CloudProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; edit?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const view = params.view ?? "all";
  const editing = params.edit;
  // `createCloudProduct`/`updateCloudProduct` gate on requireEditor; delete
  // needs an admin, so the form is told which it is dealing with.
  const canEdit = user.role !== "VIEWER";

  return (
    <>
      <SettingsHeader
        id="cloud-products"
        actions={
          <Suspense fallback={null}>
            <CategoryTabs view={view} />
          </Suspense>
        }
      />

      <div className="grid min-h-0 flex-1 items-start gap-3 lg:grid-cols-[minmax(0,340px)_1fr]">
        <Suspense fallback={null}>
          <FormCard
            canEdit={canEdit}
            canDelete={isAdminRole(user.role)}
            editing={editing}
          />
        </Suspense>

        <Suspense key={`${view}:${editing}`} fallback={<ListTableSkeleton />}>
          <Table view={view} editing={editing} canEdit={canEdit} />
        </Suspense>
      </div>
    </>
  );
}

async function CategoryTabs({ view }: { view: string }) {
  const rows = await getCloudProductRows();
  const options: TabOption[] = [
    { value: "all", label: "All", count: rows.length },
    ...CLOUD_CATEGORIES.map((category) => ({
      value: category.value,
      label: category.label.replace("Host · ", "").replace("Environment · ", ""),
      count: rows.filter((row) => row.category === category.value).length,
    })).filter((option) => option.count > 0),
  ];

  return (
    <FilterTabs
      param="view"
      value={view}
      fallback="all"
      options={options}
      label="Cloud product category"
    />
  );
}

async function FormCard({
  canEdit,
  canDelete,
  editing,
}: {
  canEdit: boolean;
  canDelete: boolean;
  editing?: string;
}) {
  if (!canEdit) {
    return (
      <Card title="Read-only">
        <CardEmpty>
          Your access lets you read pricing but not change it. Ask an
          administrator to adjust a cost or a margin.
        </CardEmpty>
      </Card>
    );
  }

  const rows = await getCloudProductRows();
  const selected = editing ? rows.find((row) => row.id === editing) : undefined;

  return (
    <Card
      title={selected ? `Edit ${selected.name}` : "Add a product"}
      meta={selected ? cloudCategoryLabel(selected.category) : "or pick a row"}
    >
      {/* Keyed on the selection, so picking another row remounts the form with
          that product's twelve fields rather than copying props into state. */}
      <CloudProductForm
        key={selected?.id ?? "new"}
        product={selected ?? null}
        canDelete={canDelete}
      />
    </Card>
  );
}

async function Table({
  view,
  editing,
  canEdit,
}: {
  view: string;
  editing?: string;
  canEdit: boolean;
}) {
  const all = await getCloudProductRows();
  const rows = view === "all" ? all : all.filter((row) => row.category === view);

  const derived = rows.filter((row) => row.sellMonthly === null).length;
  const dormant = rows.filter((row) => !row.active).length;

  return (
    <ListTable
      columns={COLUMNS}
      total={rows.length}
      footerNote={
        rows.length ? (
          <>
            {derived > 0 ? (
              <>
                {derived} monthly {derived === 1 ? "price is" : "prices are"}{" "}
                derived (·d) from cost plus margin, not set by hand
              </>
            ) : (
              <>every monthly price is set by hand</>
            )}
            {dormant > 0 ? ` · ${dormant} not sellable` : ""}
          </>
        ) : undefined
      }
      empty={
        view === "all" ? (
          <>
            No cloud pricing yet. Add a product for each CPU, RAM, GPU and
            storage option you sell — the cloud order builder can only offer what
            is priced here.
          </>
        ) : (
          <>Nothing priced in this category yet. Add one on the left.</>
        )
      }
      rows={rows.map((row) => {
        const sellMonthly =
          row.sellMonthly ??
          Math.round(row.costMonthly * (1 + row.marginPercent / 100) * 100) / 100;

        return {
          id: row.id,
          href: canEdit
            ? `/dashboard/settings/cloud-products?${new URLSearchParams({
                ...(view === "all" ? {} : { view }),
                edit: row.id,
              }).toString()}`
            : undefined,
          flagged: row.id === editing,
          cells: {
            name: (
              <span className={row.active ? "font-bold" : "text-ink-faint"}>
                {row.name}
              </span>
            ),
            group: (
              <span className="text-ink-muted">
                {cloudCategoryLabel(row.category)}
              </span>
            ),
            hour: (
              <span className="text-ink-muted">{moneyExact(row.costHourly)}</span>
            ),
            day: (
              <span className="text-ink-muted">{moneyExact(row.costDaily)}</span>
            ),
            month: (
              <span className="text-ink-muted">{moneyExact(row.costMonthly)}</span>
            ),
            margin: (
              <span className="text-ink-muted">{row.marginPercent}%</span>
            ),
            sell: (
              <span>
                {moneyExact(sellMonthly)}
                {row.sellMonthly === null ? (
                  <span className="text-ink-faint"> ·d</span>
                ) : null}
              </span>
            ),
            state: row.active ? (
              <span className="text-ink-muted">Sellable</span>
            ) : (
              <span className="text-ink-faint">Withdrawn</span>
            ),
          },
        };
      })}
    />
  );
}
