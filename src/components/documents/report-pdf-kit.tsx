import React from "react";
import { Image, StyleSheet, Text, View } from "@react-pdf/renderer";

/**
 * The frame the emailed reports print in: logo, title, subtitle and generated
 * time across the top, a teal rule, and a footer with the page count — the same
 * brand colours as the email layout (`lib/email/layout`), so the attachment
 * reads as the same document as the message it came with.
 *
 * Shared by the inventory and depreciation report PDFs only. The PO, quote and
 * invoice PDFs keep their own long-standing frames.
 */

export const INK = "#15222a";
export const MUTED = "#55606a";
export const FAINT = "#6b757e";
export const HAIRLINE = "#e7ebee";
export const SUNKEN = "#f4f6f8";
export const ACCENT = "#0081a1";
export const DANGER = "#b42318";

export const kit = StyleSheet.create({
  page: { paddingTop: 28, paddingHorizontal: 32, paddingBottom: 46, fontSize: 8, fontFamily: "Helvetica", color: INK, backgroundColor: "#ffffff" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", paddingBottom: 10, marginBottom: 12, borderBottomWidth: 2, borderBottomColor: ACCENT },
  logo: { width: 66, height: 44, objectFit: "contain", marginBottom: 8 },
  brand: { fontSize: 15, fontFamily: "Helvetica-Bold", marginBottom: 8 },
  eyebrow: { fontSize: 7, fontFamily: "Helvetica-Bold", color: ACCENT, letterSpacing: 1, textTransform: "uppercase", marginBottom: 2 },
  title: { fontSize: 16, fontFamily: "Helvetica-Bold" },
  subtitle: { fontSize: 8, color: MUTED, marginTop: 3 },
  right: { textAlign: "right", fontSize: 7, color: MUTED },
  section: { fontSize: 8, fontFamily: "Helvetica-Bold", textTransform: "uppercase", letterSpacing: 0.6, marginTop: 14, marginBottom: 4, paddingBottom: 3, borderBottomWidth: 1, borderBottomColor: INK },
  headRow: { flexDirection: "row", backgroundColor: INK, paddingVertical: 4, paddingHorizontal: 5 },
  headCell: { fontSize: 6, fontFamily: "Helvetica-Bold", color: "#ffffff", textTransform: "uppercase", letterSpacing: 0.3 },
  group: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4, paddingHorizontal: 5, backgroundColor: HAIRLINE, marginTop: 6 },
  groupText: { fontSize: 8, fontFamily: "Helvetica-Bold" },
  groupMeta: { fontSize: 7, color: MUTED },
  row: { flexDirection: "row", paddingVertical: 3, paddingHorizontal: 5, borderBottomWidth: 0.5, borderBottomColor: HAIRLINE },
  rowAlt: { flexDirection: "row", paddingVertical: 3, paddingHorizontal: 5, borderBottomWidth: 0.5, borderBottomColor: HAIRLINE, backgroundColor: SUNKEN },
  cell: { fontSize: 7.5 },
  sub: { fontSize: 6.5, color: FAINT },
  bold: { fontFamily: "Helvetica-Bold" },
  faint: { color: FAINT },
  stats: { flexDirection: "row", backgroundColor: SUNKEN, borderRadius: 3, marginBottom: 6 },
  stat: { flex: 1, padding: 8 },
  statLabel: { fontSize: 6, fontFamily: "Helvetica-Bold", color: MUTED, textTransform: "uppercase", letterSpacing: 0.5 },
  statValue: { fontSize: 13, fontFamily: "Helvetica-Bold", marginTop: 3 },
  statSub: { fontSize: 6.5, color: MUTED, marginTop: 2 },
  note: { fontSize: 7.5, color: MUTED, lineHeight: 1.45, marginBottom: 3 },
  callout: { backgroundColor: "#fffaeb", borderLeftWidth: 3, borderLeftColor: "#b54708", padding: 7, marginVertical: 6 },
  footer: { position: "absolute", bottom: 18, left: 32, right: 32, borderTopWidth: 0.5, borderTopColor: HAIRLINE, paddingTop: 5, flexDirection: "row", justifyContent: "space-between" },
  footerText: { fontSize: 6, color: FAINT },
});

export function ReportHeader({ eyebrow, title, subtitle, generated, logoDataUri }: { eyebrow: string; title: string; subtitle: string; generated: string; logoDataUri?: string }) {
  return (
    <View style={kit.header} fixed>
      <View>
        {logoDataUri ? <Image src={logoDataUri} style={kit.logo} /> : <Text style={kit.brand}>VFXnow</Text>}
        <Text style={kit.eyebrow}>{eyebrow}</Text>
        <Text style={kit.title}>{title}</Text>
        <Text style={kit.subtitle}>{subtitle}</Text>
      </View>
      <Text style={kit.right}>Generated {generated}</Text>
    </View>
  );
}

export function ReportFooter({ title }: { title: string }) {
  return (
    <View style={kit.footer} fixed>
      <Text style={kit.footerText}>VFXnow Asset Management — {title}</Text>
      <Text style={kit.footerText} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
    </View>
  );
}

export type Col = { label: string; width: string; align?: "left" | "center" | "right" };

export function HeadRow({ cols }: { cols: Col[] }) {
  return (
    <View style={kit.headRow} fixed>
      {cols.map((col) => (
        <Text key={col.label} style={[kit.headCell, { width: col.width, textAlign: col.align ?? "left" }]}>
          {col.label}
        </Text>
      ))}
    </View>
  );
}

export function Stats({ items }: { items: { label: string; value: string; sub?: string; color?: string }[] }) {
  return (
    <View style={kit.stats}>
      {items.map((item) => (
        <View key={item.label} style={kit.stat}>
          <Text style={kit.statLabel}>{item.label}</Text>
          <Text style={[kit.statValue, item.color ? { color: item.color } : {}]}>{item.value}</Text>
          {item.sub ? <Text style={kit.statSub}>{item.sub}</Text> : null}
        </View>
      ))}
    </View>
  );
}
