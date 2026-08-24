import { Suspense } from "react";
import { redirect } from "next/navigation";
import { ListSearch } from "@/components/list/list-search";
import {
  ListTable,
  ListTableSkeleton,
  type Column,
} from "@/components/list/list-table";
import { Card, CardEmpty } from "@/components/record/record-card";
import { CategoryForm } from "@/components/settings/category-form";
import { SettingsHeader } from "@/components/settings/settings-chrome";
import { getCategoryRows } from "@/lib/queries/settings";
import { getSessionUser } from "@/lib/roles";

export const metadata = { title: "Categories" };

const COLUMNS: Column[] = [
  { key: "name", label: "Category", width: "minmax(0,1fr)" },
  { key: "description", label: "Description", width: "minmax(0,1.4fr)" },
  { key: "role", label: "On an order", width: "150px" },
  { key: "life", label: "Useful life", width: "92px", align: "right" },
  { key: "assets", label: "Assets", width: "72px", align: "right" },
];

/**
 * Settings → Categories.
 *
 * How assets are grouped. Readable by anyone who can open the app; editing is
 * gated in `createCategory`/`updateCategory` by `requireEditor`, and deleting
 * by `requireAdmin`, so a viewer sees the list without the form.
 *
 * Which category the form is editing lives in the URL rather than in client
 * state, so a half-finished edit is a link somebody can send. Selecting a row
 * is a navigation, and the form is the same component either way.
 *
 * "On an order" is the only column that isn't self-explanatory, and it is the
 * one that matters: those two flags decide whether a category can host
 * sub-items on an order line, or be one. Everything else about a category is
 * naming.
 */
export default async function CategoriesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; edit?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const search = params.q?.trim() ?? "";
  const editing = params.edit;
  const canEdit = user.role !== "VIEWER";

  return (
    <>
      <SettingsHeader
        id="categories"
        actions={<ListSearch placeholder="Search categories" />}
      />

      <div className="grid min-h-0 flex-1 items-start gap-3 lg:grid-cols-[minmax(0,340px)_1fr]">
        <Suspense fallback={null}>
          <FormCard canEdit={canEdit} editing={editing} />
        </Suspense>

        <Suspense key={`${search}:${editing}`} fallback={<ListTableSkeleton />}>
          <Table search={search} editing={editing} canEdit={canEdit} />
        </Suspense>
      </div>
    </>
  );
}

async function FormCard({
  canEdit,
  editing,
}: {
  canEdit: boolean;
  editing?: string;
}) {
  if (!canEdit) {
    return (
      <Card title="Read-only">
        <CardEmpty>
          Your access lets you read the catalog but not change it. Ask an
          administrator to add or rename a category.
        </CardEmpty>
      </Card>
    );
  }

  const rows = await getCategoryRows("");
  const selected = editing ? rows.find((row) => row.id === editing) : undefined;

  return (
    <Card
      title={selected ? `Edit ${selected.name}` : "Add a category"}
      meta={selected ? undefined : "or pick a row to change one"}
    >
      {/* Keyed on the selection, so picking another row remounts the form with
          that row's values instead of an effect copying props into state. */}
      <CategoryForm
        key={selected?.id ?? "new"}
        category={
          selected
            ? {
                id: selected.id,
                name: selected.name,
                description: selected.description,
                isConfigurable: selected.isConfigurable,
                isComponent: selected.isComponent,
                assets: selected.assets,
              }
            : null
        }
      />
    </Card>
  );
}

async function Table({
  search,
  editing,
  canEdit,
}: {
  search: string;
  editing?: string;
  canEdit: boolean;
}) {
  const categories = await getCategoryRows(search);
  const empties = categories.filter((row) => row.assets === 0).length;

  return (
    <ListTable
      columns={COLUMNS}
      total={categories.length}
      footerNote={
        empties > 0 ? (
          <>
            {empties} hold nothing — safe to remove, or waiting to be filled
          </>
        ) : undefined
      }
      empty={
        search ? (
          <>No category matches &ldquo;{search}&rdquo;.</>
        ) : (
          <>
            No categories yet. Add one before registering assets — every asset
            belongs to exactly one, and the category sets its default
            depreciation.
          </>
        )
      }
      rows={categories.map((row) => ({
        id: row.id,
        href: canEdit ? `/dashboard/settings/categories?edit=${row.id}` : undefined,
        flagged: row.id === editing,
        cells: {
          name: <span className="font-bold">{row.name}</span>,
          description: (
            <span className="text-ink-muted">
              {row.description ?? <span className="text-ink-faint">—</span>}
            </span>
          ),
          role: (
            <span className="text-ink-muted">
              {row.isConfigurable && row.isComponent
                ? "Builds and fits"
                : row.isConfigurable
                  ? "Builds a config"
                  : row.isComponent
                    ? "Fits inside one"
                    : <span className="text-ink-faint">Books on its own</span>}
            </span>
          ),
          life: (
            <span className="tabular-nums text-ink-muted">
              {row.usefulLifeMonths} mo
            </span>
          ),
          assets: row.assets || <span className="text-ink-faint">0</span>,
        },
      }))}
    />
  );
}
