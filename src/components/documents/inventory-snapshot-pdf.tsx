import React from "react";
import { Document, Page, Text, View } from "@react-pdf/renderer";
import type { InventorySnapshotData } from "@/lib/inventory/snapshot";
import { ACCENT, DANGER, HeadRow, ReportFooter, ReportHeader, Stats, kit, type Col } from "./report-pdf-kit";

/**
 * The full inventory report, attached to the emailed Inventory report. Ported
 * from v1's `inventory-snapshot-pdf` with the same six columns as the email,
 * in the shared report frame.
 */

const COLS: Col[] = [
  { label: "Item", width: "44%" },
  { label: "In stock", width: "10%", align: "center" },
  { label: "Out", width: "10%", align: "center" },
  { label: "Going", width: "10%", align: "center" },
  { label: "Back", width: "10%", align: "center" },
  { label: "Monthly", width: "16%", align: "right" },
];

const MONEY = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const count = (n: number) => (n === 0 ? "—" : String(n));

export function InventorySnapshotPDF({ data, title, logoDataUri }: { data: InventorySnapshotData; title: string; logoDataUri?: string }) {
  const s = data.summary;
  return (
    <Document title={title}>
      <Page size="LETTER" style={kit.page}>
        <ReportHeader
          eyebrow="Inventory report"
          title={title}
          subtitle={`Stock and monthly rates — ${data.horizonDays}-day outlook (${data.horizonLabel})`}
          generated={data.generatedAtLabel}
          logoDataUri={logoDataUri}
        />
        <Stats
          items={[
            { label: "In stock", value: String(s.inStock) },
            { label: "Out", value: String(s.out), sub: `${s.utilizationPercent}% of ${s.totalUnits}` },
            { label: "Going out", value: String(s.goingOut + s.lateToShip), sub: s.lateToShip ? `${s.lateToShip} past their ship date` : undefined, color: DANGER },
            { label: "Coming back", value: String(s.comingBack), sub: s.overdueBack ? `${s.overdueBack} overdue, not counted` : undefined, color: ACCENT },
            { label: "On quotes", value: String(s.quoted) },
          ]}
        />
        <HeadRow cols={COLS} />
        {data.categories.map((category) => (
          <View key={category.category}>
            <View style={kit.group} minPresenceAhead={40}>
              <Text style={kit.groupText}>{category.category}</Text>
              <Text style={kit.groupMeta}>
                {category.totals.inStock} in stock · {category.totals.out} out
              </Text>
            </View>
            {category.rows.map((row, index) => {
              const going = row.goingOut + row.lateToShip;
              return (
                <View key={row.assetId} style={index % 2 === 0 ? kit.row : kit.rowAlt} wrap={false}>
                  <View style={{ width: COLS[0].width }}>
                    <Text style={kit.cell}>{row.assetName}</Text>
                    {row.manufacturer || row.model ? <Text style={kit.sub}>{[row.manufacturer, row.model].filter(Boolean).join(" · ")}</Text> : null}
                  </View>
                  <Text style={[kit.cell, kit.bold, { width: COLS[1].width, textAlign: "center" }, row.inStock === 0 ? kit.faint : {}]}>{count(row.inStock)}</Text>
                  <Text style={[kit.cell, { width: COLS[2].width, textAlign: "center" }, row.out === 0 ? kit.faint : {}]}>{count(row.out)}</Text>
                  <Text style={[kit.cell, { width: COLS[3].width, textAlign: "center" }, going === 0 ? kit.faint : { color: DANGER }]}>{count(going)}</Text>
                  <Text style={[kit.cell, { width: COLS[4].width, textAlign: "center" }, row.comingBack === 0 ? kit.faint : { color: ACCENT }]}>{count(row.comingBack)}</Text>
                  <Text style={[kit.cell, { width: COLS[5].width, textAlign: "right" }]}>{row.monthlyRate ? MONEY.format(row.monthlyRate) : "—"}</Text>
                </View>
              );
            })}
          </View>
        ))}
        <Text style={[kit.note, { marginTop: 10 }]}>
          Going counts units on confirmed orders not yet checked out, including those past their ship date. Back counts units due inside the window; recurring rentals and overdue returns are excluded, because neither promises stock.
        </Text>
        <ReportFooter title={title} />
      </Page>
    </Document>
  );
}
