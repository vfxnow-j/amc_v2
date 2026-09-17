import React from "react";
import { Document, Page, Text, View } from "@react-pdf/renderer";
import type { FixedAssetRow, FixedAssetTotals } from "@/lib/queries/fixed-assets";
import { METHOD_LABEL, OWNERSHIP_LABEL } from "@/lib/queries/fixed-assets";
import { HeadRow, ReportFooter, ReportHeader, Stats, kit, type Col } from "./report-pdf-kit";

/**
 * The fixed asset register as a PDF for accounting: totals, then every unit
 * grouped by category with a subtotal per category, then how the figures are
 * made. Landscape, because the register is wide; the CSV carries every column.
 */

const MONEY = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const WHOLE = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Los_Angeles" });

const COLS: Col[] = [
  { label: "Unit / model", width: "24%" },
  { label: "Ownership", width: "15%" },
  { label: "In service", width: "8%" },
  { label: "Cost", width: "8%", align: "right" },
  { label: "Market", width: "7%", align: "right" },
  { label: "Orders", width: "6%", align: "center" },
  { label: "Schedule", width: "9%" },
  { label: "Accumulated", width: "8%", align: "right" },
  { label: "Book value", width: "8%", align: "right" },
  { label: "Earned", width: "7%", align: "right" },
];

const dash = (value: number | null | undefined) => (value === null || value === undefined ? "—" : MONEY.format(value));

function sumRows(rows: FixedAssetRow[]) {
  return rows.reduce(
    (sum, row) => ({
      cost: sum.cost + (row.cost ?? 0),
      accumulated: sum.accumulated + (row.depreciation?.accumulated ?? 0),
      book: sum.book + (row.depreciation?.book ?? 0),
      revenue: sum.revenue + row.revenue,
    }),
    { cost: 0, accumulated: 0, book: 0, revenue: 0 },
  );
}

export function FixedAssetsPDF({
  rows,
  totals,
  scope,
  generatedAt,
  logoDataUri,
}: {
  rows: FixedAssetRow[];
  totals: FixedAssetTotals;
  /** The filters in words — "In service · Loan / lease · Workstations". */
  scope: string;
  generatedAt: Date;
  logoDataUri?: string;
}) {
  const byCategory = new Map<string, FixedAssetRow[]>();
  for (const row of rows) byCategory.set(row.category, [...(byCategory.get(row.category) ?? []), row]);
  const notValued = rows.filter((row) => !row.depreciation);
  const categories = [...byCategory.entries()].sort(([a], [b]) => a.localeCompare(b));

  // Laid out in explicit pages rather than one long page react-pdf breaks up
  // itself: its pagination re-lays the whole flow and grew super-linearly —
  // 24 s for the 863-unit register. Fixed pages render independently, and each
  // repeats the column header.
  type Item =
    | { kind: "group"; category: string; count: number; sub: ReturnType<typeof sumRows> }
    | { kind: "row"; row: FixedAssetRow; index: number };
  const items: Item[] = [];
  for (const [category, group] of categories) {
    items.push({ kind: "group", category, count: group.length, sub: sumRows(group) });
    group.forEach((row, index) => items.push({ kind: "row", row, index }));
  }
  // Pages are packed by estimated height in points, so a row whose model or
  // lender wraps doesn't push the page over and leave react-pdf a one-row
  // spill page. Widths are the column's share of a landscape Letter row; the
  // per-character widths are Helvetica's averages at these sizes, rounded up.
  const ROW_WIDTH = 718;
  const linesFor = (text: string, share: number, perChar: number) =>
    Math.max(1, Math.ceil(text.length / Math.floor((ROW_WIDTH * share - 4) / perChar)));
  const rowHeight = (row: FixedAssetRow) => {
    const unitSub = `${row.barcode}${row.serialNumber ? ` · S/N ${row.serialNumber}` : ""}${row.disposal ? ` · ${row.disposal.how}` : ""}`;
    const owner = row.financing ? [row.financing.name, row.financing.lender].filter(Boolean).join(" · ") : row.vendor ?? "";
    const lines = Math.max(
      linesFor(row.model, 0.24, 4.4) + linesFor(unitSub, 0.24, 3.2),
      linesFor(OWNERSHIP_LABEL[row.ownership], 0.15, 4) + linesFor(owner, 0.15, 3.2),
      row.depreciation ? 2 : linesFor(row.notValuedReason ?? "", 0.09, 4),
    );
    return 8 + lines * 9;
  };
  const GROUP_HEIGHT = 24;
  const BODY_HEIGHT = 440; // Letter landscape less padding, header, column heads and footer
  const STATS_HEIGHT = 64;
  const pages: Item[][] = [];
  let page: Item[] = [];
  let room = BODY_HEIGHT - STATS_HEIGHT;
  for (const item of items) {
    const height = item.kind === "group" ? GROUP_HEIGHT + 20 : rowHeight(item.row);
    if (page.length && height > room) {
      pages.push(page);
      page = [];
      room = BODY_HEIGHT;
    }
    page.push(item);
    room -= item.kind === "group" ? GROUP_HEIGHT : height;
  }
  if (page.length) pages.push(page);
  if (pages.length === 0) pages.push([]);

  const renderRow = (row: FixedAssetRow, index: number) => (
        <View style={index % 2 === 0 ? kit.row : kit.rowAlt}>
          <Text style={[kit.cell, { width: COLS[0].width }]}>
            <Text style={kit.bold}>{row.model}</Text>
            <Text style={kit.sub}>
              {`\n${row.barcode}${row.serialNumber ? ` · S/N ${row.serialNumber}` : ""}${
                row.disposal ? ` · ${row.disposal.how}${row.disposal.proceeds !== null ? ` ${MONEY.format(row.disposal.proceeds)}` : ""}` : ""
              }`}
            </Text>
          </Text>
          <Text style={[kit.cell, { width: COLS[1].width }]}>
            {OWNERSHIP_LABEL[row.ownership]}
            <Text style={kit.sub}>
              {`\n${row.financing ? [row.financing.name, row.financing.lender].filter(Boolean).join(" · ") : row.vendor ?? ""}`}
            </Text>
          </Text>
          <Text style={[kit.cell, { width: COLS[2].width }]}>{DAY.format(row.inServiceDate)}</Text>
          <Text style={[kit.cell, { width: COLS[3].width, textAlign: "right" }]}>{dash(row.cost)}</Text>
          <Text style={[kit.cell, { width: COLS[4].width, textAlign: "right" }]}>{dash(row.marketValue)}</Text>
          <Text style={[kit.cell, { width: COLS[5].width, textAlign: "center" }]}>{row.orders}</Text>
          <Text style={[kit.cell, { width: COLS[6].width }, row.depreciation ? {} : kit.faint]}>
            {row.depreciation ? METHOD_LABEL[row.depreciation.method] ?? row.depreciation.method : row.notValuedReason}
            {row.depreciation ? (
              <Text style={kit.sub}>
                {`\n${
                  row.depreciation.fullyDepreciated
                    ? "fully depreciated"
                    : `${Math.min(row.depreciation.monthsElapsed, row.depreciation.lifeMonths)} of ${row.depreciation.lifeMonths} mo`
                }`}
              </Text>
            ) : null}
          </Text>
          <Text style={[kit.cell, { width: COLS[7].width, textAlign: "right" }]}>{dash(row.depreciation?.accumulated)}</Text>
          <Text style={[kit.cell, kit.bold, { width: COLS[8].width, textAlign: "right" }]}>{dash(row.depreciation?.book)}</Text>
          <Text style={[kit.cell, { width: COLS[9].width, textAlign: "right" }]}>{MONEY.format(row.revenue)}</Text>
        </View>
  );

  return (
    <Document title={`Fixed asset register — ${scope}`}>
      {pages.map((pageItems, pageIndex) => (
        <Page key={pageIndex} size="LETTER" orientation="landscape" style={kit.page}>
          <ReportHeader
            eyebrow="Fixed asset register"
            title="Fixed assets"
            subtitle={scope}
            generated={DAY.format(generatedAt)}
            logoDataUri={logoDataUri}
          />
          {pageIndex === 0 ? (
            <Stats
              items={[
                { label: "Units", value: totals.units.toLocaleString("en-US"), sub: `${totals.valued} valued · ${totals.notValued} not` },
                { label: "Cost", value: WHOLE.format(totals.cost) },
                { label: "Accumulated depreciation", value: WHOLE.format(totals.accumulated) },
                { label: "Book value", value: WHOLE.format(totals.book) },
                { label: "Market value", value: WHOLE.format(totals.marketValue), sub: "where researched" },
                { label: "Earned", value: WHOLE.format(totals.revenue), sub: `${totals.orders.toLocaleString("en-US")} order placements` },
              ]}
            />
          ) : null}
          <HeadRow cols={COLS} />
          {pageItems.map((item) =>
            item.kind === "group" ? (
              <View key={`g-${item.category}`} style={kit.group}>
                <Text style={kit.groupText}>{item.category}</Text>
                <Text style={kit.groupMeta}>
                  {item.count} units · cost {MONEY.format(item.sub.cost)} · accumulated {MONEY.format(item.sub.accumulated)} · book{" "}
                  {MONEY.format(item.sub.book)} · earned {MONEY.format(item.sub.revenue)}
                </Text>
              </View>
            ) : (
              <View key={item.row.unitId}>{renderRow(item.row, item.index)}</View>
            ),
          )}
          <ReportFooter title="Fixed asset register" />
        </Page>
      ))}
      <Page size="LETTER" orientation="landscape" style={kit.page}>
        <ReportHeader
          eyebrow="Fixed asset register"
          title="Fixed assets"
          subtitle={scope}
          generated={DAY.format(generatedAt)}
          logoDataUri={logoDataUri}
        />
        <Text style={kit.section}>How these figures are made</Text>
        <Text style={kit.note}>
          Book value and accumulated depreciation follow each model&apos;s schedule (method, useful life, salvage) from the
          unit&apos;s in-service date — its received date, or its purchase date when it was never received against a
          purchase order. Salvage is the floor. These are the same figures the unit records and the scheduled
          depreciation report show.
        </Text>
        <Text style={kit.note}>
          Market value is the model&apos;s researched resale price where one exists; it is not a book figure. Earned is
          rental revenue booked against the unit. Orders counts the distinct orders the unit has been checked out on.
        </Text>
        {notValued.length ? (
          <View style={kit.callout}>
            <Text style={[kit.cell, kit.bold]}>
              {notValued.length} {notValued.length === 1 ? "unit is" : "units are"} not valued
            </Text>
            <Text style={kit.note}>
              They are listed above without a book value and left out of the depreciation totals rather than valued at
              cost or at zero:{" "}
              {Object.entries(
                notValued.reduce<Record<string, number>>((acc, row) => {
                  acc[row.notValuedReason ?? "Unknown"] = (acc[row.notValuedReason ?? "Unknown"] ?? 0) + 1;
                  return acc;
                }, {}),
              )
                .map(([reason, count]) => `${reason} (${count})`)
                .join(", ")}
              .
            </Text>
          </View>
        ) : null}
        <ReportFooter title="Fixed asset register" />
      </Page>
    </Document>
  );
}
