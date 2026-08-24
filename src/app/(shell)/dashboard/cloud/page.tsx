import { Suspense } from "react";
import {
  ListTable,
  ListTableSkeleton,
  type Column,
} from "@/components/list/list-table";
import { PageHeader } from "@/components/shell/page-header";
import { moneyExact } from "@/lib/format";
import { getCloudProducts } from "@/lib/queries/operate";

export const metadata = { title: "Cloud services" };

const CATEGORY_LABEL: Record<string, string> = {
  HOST_CPU: "Host · CPU",
  HOST_RAM: "Host · RAM",
  HOST_STORAGE: "Host · Storage",
  HOST_GRAPHICS: "Host · Graphics",
  HOST_NETWORKING: "Host · Network",
  ENV_INTERNET: "Env · Internet",
  ENV_STORAGE: "Env · Storage",
  ENV_ADDON: "Env · Add-on",
};

const COLUMNS: Column[] = [
  { key: "category", label: "Category", width: "150px" },
  { key: "name", label: "Product", width: "minmax(0,1fr)" },
  { key: "description", label: "Note", width: "minmax(0,1.2fr)" },
  { key: "cost", label: "Cost / mo", width: "100px", align: "right" },
  { key: "sell", label: "Sell / mo", width: "108px", align: "right" },
  { key: "margin", label: "Margin", width: "78px", align: "right" },
  { key: "ordered", label: "Ordered", width: "82px", align: "right" },
];

async function Table() {
  const products = await getCloudProducts();
  const inactive = products.filter((product) => !product.active).length;
  const derived = products.filter((product) => product.derived).length;

  // The "·d" marker is two characters and means nothing on its own, so the
  // footer says what it is. Most of this catalog carries no override, which
  // makes the legend the difference between a priced list and a cryptic one.
  const notes = [
    inactive > 0 ? `${inactive} not offered` : null,
    derived > 0 ? `${derived} sell prices derived (·d) from cost + margin` : null,
  ].filter(Boolean);

  return (
    <ListTable
      columns={COLUMNS}
      total={products.length}
      footerNote={notes.length > 0 ? notes.join(" · ") : null}
      empty={
        <>
          No cloud products defined. These are the CPU, RAM, storage and GPU
          options a cloud workstation is built from — an order can&rsquo;t
          include cloud until at least one exists.
        </>
      }
      rows={products.map((product) => ({
        id: product.id,
        cells: {
          category: (
            <span className="text-ink-muted">
              {CATEGORY_LABEL[product.category] ?? product.category}
            </span>
          ),
          name: (
            <span className={product.active ? "font-bold" : "font-bold opacity-60"}>
              {product.name}
              {product.active ? null : (
                <span className="font-normal text-ink-faint"> · off</span>
              )}
            </span>
          ),
          description: (
            <span className="text-ink-muted">{product.description ?? "—"}</span>
          ),
          cost: moneyExact(product.costMonthly),
          // A derived sell price is a rule, not a decision someone made — say
          // which it is rather than showing two numbers that look equally firm.
          sell: (
            <>
              {moneyExact(product.sellMonthly)}
              {product.derived ? (
                <span
                  className="text-ink-faint"
                  title="Derived from cost + margin; no sell price is set on this product"
                >
                  {" "}
                  ·d
                </span>
              ) : null}
            </>
          ),
          margin: (
            <span className="text-ink-muted">{product.marginPercent}%</span>
          ),
          ordered: product.timesOrdered || (
            <span className="text-ink-faint">—</span>
          ),
        },
      }))}
    />
  );
}

/**
 * Operate → Cloud services.
 *
 * In Operate rather than Revenue by the owner's call (2026-07-28): cloud is
 * something the team provisions day to day, and the money it makes surfaces
 * through Invoices like everything else.
 *
 * Sell prices marked "·d" are derived from cost × (1 + margin) because the
 * product carries no override — that's the rule the pricing code applies, and
 * showing it as if someone had set it would hide where the number came from.
 */
export default async function CloudPage() {
  return (
    <>
      <PageHeader
        eyebrow="Operate"
        title="Cloud services"
        blurb="The catalog a cloud workstation is configured from"
      />

      <Suspense fallback={<ListTableSkeleton />}>
        <Table />
      </Suspense>
    </>
  );
}
