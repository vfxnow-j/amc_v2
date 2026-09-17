import React from "react";
import { Document, Page, Text, View } from "@react-pdf/renderer";
import type { DepreciationReport, DepreciationUnit } from "@/lib/inventory/depreciation-report";
import { ACCENT, HeadRow, ReportFooter, ReportHeader, Stats, kit, type Col } from "./report-pdf-kit";

/**
 * The depreciation report as a branded PDF: the summary, every family and
 * model, units fully depreciated now and in the next 90 days, every unit left
 * out and why, and how the figures are made. The unit-level schedule is the CSV.
 */

const MONEY = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Los_Angeles" });

const GROUP_COLS: Col[] = [
  { label: "Family / model", width: "34%" },
  { label: "Units", width: "7%", align: "right" },
  { label: "Cost", width: "15%", align: "right" },
  { label: "Accumulated", width: "15%", align: "right" },
  { label: "Book value", width: "15%", align: "right" },
  { label: "Period expense", width: "14%", align: "right" },
];

const UNIT_COLS: Col[] = [
  { label: "Unit", width: "12%" },
  { label: "Model", width: "34%" },
  { label: "In service", width: "14%" },
  { label: "Fully depreciated", width: "14%" },
  { label: "Cost", width: "13%", align: "right" },
  { label: "Book now", width: "13%", align: "right" },
];

function UnitTable({ units, empty }: { units: DepreciationUnit[]; empty: string }) {
  if (units.length === 0) return <Text style={kit.note}>{empty}</Text>;
  return (
    <View>
      <HeadRow cols={UNIT_COLS} />
      {units.map((unit, index) => (
        <View key={unit.barcode} style={index % 2 === 0 ? kit.row : kit.rowAlt} wrap={false}>
          <Text style={[kit.cell, { width: UNIT_COLS[0].width }]}>{unit.barcode}</Text>
          <Text style={[kit.cell, { width: UNIT_COLS[1].width }]}>{unit.model}</Text>
          <Text style={[kit.cell, { width: UNIT_COLS[2].width }]}>{DAY.format(unit.inServiceDate)}</Text>
          <Text style={[kit.cell, { width: UNIT_COLS[3].width }]}>{DAY.format(unit.fullyDepreciatedOn)}</Text>
          <Text style={[kit.cell, { width: UNIT_COLS[4].width, textAlign: "right" }]}>{MONEY.format(unit.cost)}</Text>
          <Text style={[kit.cell, { width: UNIT_COLS[5].width, textAlign: "right" }]}>{MONEY.format(unit.book)}</Text>
        </View>
      ))}
    </View>
  );
}

export function DepreciationReportPDF({ report, notes, logoDataUri }: { report: DepreciationReport; notes: string[]; logoDataUri?: string }) {
  const t = report.totals;
  const title = `Depreciation report — ${report.period.label}`;
  return (
    <Document title={title}>
      <Page size="LETTER" style={kit.page}>
        <ReportHeader
          eyebrow="Depreciation report"
          title="Book value of the fleet"
          subtitle={`As of ${DAY.format(report.asOf)} · period expense for ${report.period.label}`}
          generated={report.asOf.toLocaleString("en-US", { timeZone: "America/Los_Angeles", dateStyle: "medium", timeStyle: "short" }) + " PT"}
          logoDataUri={logoDataUri}
        />
        <Stats
          items={[
            { label: "Cost", value: MONEY.format(t.cost), sub: `${t.valuedUnits} of ${t.fleetUnits} fleet units` },
            { label: "Accumulated", value: MONEY.format(t.accumulated) },
            { label: "Net book value", value: MONEY.format(t.book), color: ACCENT },
            { label: "Period expense", value: MONEY.format(t.periodExpense), sub: report.period.label },
          ]}
        />
        {report.excluded.length > 0 ? (
          <View style={kit.callout}>
            <Text style={kit.cell}>
              {report.excluded.length} of {t.fleetUnits} fleet units are not counted in any figure here — listed at the end with the reason. They are not valued at zero; they are left out.
            </Text>
          </View>
        ) : null}

        <Text style={kit.section}>By family, largest cost first</Text>
        <HeadRow cols={GROUP_COLS} />
        {report.groups.map((group, index) => (
          <View key={`${group.grouped}:${group.name}`} style={index % 2 === 0 ? kit.row : kit.rowAlt} wrap={false}>
            <View style={{ width: GROUP_COLS[0].width }}>
              <Text style={kit.cell}>{group.name}</Text>
              {group.grouped ? null : <Text style={kit.sub}>Model with no family</Text>}
            </View>
            <Text style={[kit.cell, { width: GROUP_COLS[1].width, textAlign: "right" }]}>{group.units}</Text>
            <Text style={[kit.cell, { width: GROUP_COLS[2].width, textAlign: "right" }]}>{MONEY.format(group.cost)}</Text>
            <Text style={[kit.cell, { width: GROUP_COLS[3].width, textAlign: "right" }]}>{MONEY.format(group.accumulated)}</Text>
            <Text style={[kit.cell, kit.bold, { width: GROUP_COLS[4].width, textAlign: "right" }]}>{MONEY.format(group.book)}</Text>
            <Text style={[kit.cell, { width: GROUP_COLS[5].width, textAlign: "right" }]}>{MONEY.format(group.periodExpense)}</Text>
          </View>
        ))}
        <View style={[kit.row, { borderTopWidth: 1, borderTopColor: "#15222a" }]} wrap={false}>
          <Text style={[kit.cell, kit.bold, { width: GROUP_COLS[0].width }]}>Total</Text>
          <Text style={[kit.cell, kit.bold, { width: GROUP_COLS[1].width, textAlign: "right" }]}>{t.valuedUnits}</Text>
          <Text style={[kit.cell, kit.bold, { width: GROUP_COLS[2].width, textAlign: "right" }]}>{MONEY.format(t.cost)}</Text>
          <Text style={[kit.cell, kit.bold, { width: GROUP_COLS[3].width, textAlign: "right" }]}>{MONEY.format(t.accumulated)}</Text>
          <Text style={[kit.cell, kit.bold, { width: GROUP_COLS[4].width, textAlign: "right" }]}>{MONEY.format(t.book)}</Text>
          <Text style={[kit.cell, kit.bold, { width: GROUP_COLS[5].width, textAlign: "right" }]}>{MONEY.format(t.periodExpense)}</Text>
        </View>

        <Text style={kit.section} break>Fully depreciating in the next 90 days · {report.fullyDepreciatingSoon.length}</Text>
        <UnitTable units={report.fullyDepreciatingSoon} empty="Nothing reaches the end of its schedule in the next 90 days." />

        <Text style={kit.section}>Fully depreciated · {report.fullyDepreciated.length}</Text>
        <UnitTable units={report.fullyDepreciated} empty="No unit in the fleet is fully depreciated." />

        <Text style={kit.section}>Not counted · {report.excluded.length}</Text>
        {report.excluded.length === 0 ? (
          <Text style={kit.note}>Every fleet unit is valued.</Text>
        ) : (
          report.excluded.map((unit, index) => (
            <View key={unit.barcode} style={index % 2 === 0 ? kit.row : kit.rowAlt} wrap={false}>
              <Text style={[kit.cell, { width: "14%" }]}>{unit.barcode}</Text>
              <Text style={[kit.cell, { width: "56%" }]}>{unit.model}</Text>
              <Text style={[kit.cell, { width: "30%" }]}>{unit.reason}</Text>
            </View>
          ))
        )}

        <Text style={kit.section}>How these figures are made</Text>
        {notes.map((note) => (
          <Text key={note} style={kit.note}>
            • {note}
          </Text>
        ))}
        <ReportFooter title={title} />
      </Page>
    </Document>
  );
}
