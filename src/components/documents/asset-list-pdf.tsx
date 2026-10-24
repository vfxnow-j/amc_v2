import React from 'react'
import { Document, Page, View, Text, Image } from '@react-pdf/renderer'
import { pdfStyles as s } from './pdf-styles'
import type { OrderDetailData } from './order-detail-pdf'

type Props = {
  data: OrderDetailData
  logoDataUri?: string
  /** Chosen at print time — serials add a second line per unit, so they're opt-in. */
  includeSerials?: boolean
}

const col = {
  check: { width: '5%' },
  qty: { width: '7%', textAlign: 'center' as const },
  asset: { width: '73%', paddingRight: 8 },
  assigned: { width: '15%', textAlign: 'right' as const },
}

const chip = {
  fontSize: 7.5,
  color: '#334155',
  backgroundColor: '#eef2f7',
  borderRadius: 2,
  paddingVertical: 1.5,
  paddingHorizontal: 4,
  marginRight: 3,
  marginBottom: 3,
}

type Unit = { barcode?: string; serialNumber?: string }

type Row = {
  description: string
  makeModel?: string
  quantity: number
  units: Unit[]
  isComponent?: boolean
  /** False for services / ad-hoc lines — they have no units, so no assigned count. */
  isAsset: boolean
}

/**
 * Collapses order items into one row per distinct product — quantities summed and
 * assigned units pooled — so an order that lists the same asset on several lines
 * (or one line of qty 5) prints as a single "5x" entry rather than repeated rows.
 */
function buildRows(items: OrderDetailData['items']): Row[] {
  const byProduct = new Map<string, Row>()
  const order: Row[] = []

  for (const item of items) {
    const makeModel = [item.manufacturer, item.model].filter(Boolean).join(' ') || undefined
    const key = `${item.isComponent ? 'c' : 'p'}|${item.description}|${makeModel || ''}`

    let row = byProduct.get(key)
    if (!row) {
      row = {
        description: item.description,
        makeModel,
        quantity: 0,
        units: [],
        isComponent: item.isComponent,
        isAsset: item.isAsset !== false,
      }
      byProduct.set(key, row)
      order.push(row)
    }

    row.quantity += item.quantity || 1
    if (item.isAsset === false) row.isAsset = false

    const units: Unit[] = item.units && item.units.length > 0
      ? item.units.map((u) => ({ barcode: u.barcode || undefined, serialNumber: u.serialNumber || undefined }))
      : (item.assetNumbers || []).map((n) => ({ barcode: n }))
    for (const unit of units) {
      if (!unit.barcode && !unit.serialNumber) continue
      // Guard against the same unit arriving twice (e.g. duplicated lines)
      const dup = row.units.some(
        (u) =>
          (unit.barcode && u.barcode === unit.barcode) ||
          (unit.serialNumber && u.serialNumber === unit.serialNumber)
      )
      if (!dup) row.units.push(unit)
    }
  }

  return order
}

export function AssetListPDF({ data, logoDataUri, includeSerials = false }: Props) {
  // Group by category, preserving the order items arrive in.
  const catOrder: string[] = []
  const catMap = new Map<string, OrderDetailData['items']>()
  for (const item of data.items) {
    const cat = item.category || 'Other'
    if (!catMap.has(cat)) {
      catMap.set(cat, [])
      catOrder.push(cat)
    }
    catMap.get(cat)!.push(item)
  }
  const groups = catOrder.map((category) => ({ category, rows: buildRows(catMap.get(category)!) }))
  const hasCategories = groups.length > 1 || (groups.length === 1 && groups[0].category !== 'Other')

  const totalUnits = groups.reduce(
    (sum, g) => sum + g.rows.reduce((rs, r) => rs + r.quantity, 0),
    0
  )
  const taggedUnits = groups.reduce(
    (sum, g) => sum + g.rows.reduce((rs, r) => rs + r.units.length, 0),
    0
  )

  let rowIdx = 0

  return (
    <Document>
      <Page size="LETTER" style={[s.page, { paddingBottom: 60 }]}>
        {/* Header */}
        <View style={s.header}>
          <View style={s.headerLeft}>
            {logoDataUri ? (
              <Image src={logoDataUri} style={s.logo} />
            ) : (
              <Text style={s.documentTitle}>AMC</Text>
            )}
          </View>
          <View style={s.headerRight}>
            <Text style={s.documentTitle}>Asset List</Text>
            <Text style={s.documentNumber}>{data.number}</Text>
            <Text style={{ fontSize: 9, color: '#6b7280', marginTop: 4 }}>
              Status: {data.status}
            </Text>
          </View>
        </View>

        {/* Info Section */}
        <View style={s.infoSection} wrap={false}>
          <View style={s.infoBox}>
            <Text style={s.infoBoxTitle}>{data.contactLabel}</Text>
            <Text style={s.infoBoxTextBold}>{data.contactName}</Text>
            {data.contactCompany && <Text style={s.infoBoxText}>{data.contactCompany}</Text>}
            {data.contactEmail && <Text style={s.infoBoxText}>{data.contactEmail}</Text>}
            {data.contactPhone && <Text style={s.infoBoxText}>{data.contactPhone}</Text>}
            {data.contactAddress && <Text style={s.infoBoxText}>{data.contactAddress}</Text>}
          </View>
          <View style={s.infoBox}>
            <Text style={s.infoBoxTitle}>Order Details</Text>
            <Text style={s.infoBoxText}>
              {data.dateLabel}: {data.startDate}
              {data.endDate ? ` – ${data.endDate}` : ''}
            </Text>
            {data.projectName && <Text style={s.infoBoxText}>Project: {data.projectName}</Text>}
            {data.projectCode && <Text style={s.infoBoxText}>Code: {data.projectCode}</Text>}
            <Text style={s.infoBoxText}>
              {totalUnits} item{totalUnits === 1 ? '' : 's'} · {taggedUnits} of {totalUnits} assigned
            </Text>
          </View>
        </View>

        {/* Shipping — where it goes, how, and when, so the list doubles as the pack sheet */}
        {(data.deliveryMethod || data.returnMethod) && (
          <View style={{ marginBottom: 12 }} wrap={false}>
            <Text style={{ fontSize: 10, fontFamily: 'Helvetica-Bold', marginBottom: 6 }}>Shipping</Text>
            <View style={{ flexDirection: 'row', gap: 20 }}>
              {data.deliveryMethod && (
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', marginBottom: 3 }}>Delivery</Text>
                  <Text style={{ fontSize: 9 }}>Method: {data.deliveryMethod}</Text>
                  {data.deliveryAddress && <Text style={{ fontSize: 9 }}>Ship to: {data.deliveryAddress}</Text>}
                  {data.shipDate && <Text style={{ fontSize: 9 }}>Ships: {data.shipDate}</Text>}
                  {data.deliveryDate && <Text style={{ fontSize: 9 }}>Arrives: {data.deliveryDate}</Text>}
                  {data.deliveryTrackingProvider && <Text style={{ fontSize: 9 }}>Carrier: {data.deliveryTrackingProvider}</Text>}
                  {data.deliveryTrackingNumber && <Text style={{ fontSize: 9 }}>Tracking #: {data.deliveryTrackingNumber}</Text>}
                  {data.deliveryNotes && <Text style={{ fontSize: 9, color: '#6b7280' }}>{data.deliveryNotes}</Text>}
                </View>
              )}
              {data.returnMethod && (
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', marginBottom: 3 }}>Return</Text>
                  <Text style={{ fontSize: 9 }}>Method: {data.returnMethod}</Text>
                  {data.returnDate && <Text style={{ fontSize: 9 }}>Date: {data.returnDate}</Text>}
                  {data.returnTrackingProvider && <Text style={{ fontSize: 9 }}>Carrier: {data.returnTrackingProvider}</Text>}
                  {data.returnTrackingNumber && <Text style={{ fontSize: 9 }}>Tracking #: {data.returnTrackingNumber}</Text>}
                </View>
              )}
            </View>
          </View>
        )}

        {/* Asset Table — the header sits outside the table container so react-pdf's
            `fixed` repeat doesn't push the whole body onto a fresh page */}
        <View style={s.tableHeader} fixed>
          <Text style={[s.tableHeaderCell, col.check]}> </Text>
          <Text style={[s.tableHeaderCell, col.qty]}>Qty</Text>
          <Text style={[s.tableHeaderCell, col.asset]}>
            {includeSerials ? 'Asset / Tags & Serials' : 'Asset / Barcodes'}
          </Text>
          <Text style={[s.tableHeaderCell, col.assigned]}>Assigned</Text>
        </View>
        <View style={s.table}>

          {groups.map((group) => {
            const renderRow = (row: Row, i: number) => {
                const alt = rowIdx++ % 2 !== 0
                const complete = row.units.length >= row.quantity
                return (
                  <View
                    key={i}
                    /* Rows stay atomic so a product's barcodes never orphan onto the
                       next page without their name; only absurdly long ones may break */
                    wrap={row.units.length > 250}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'flex-start',
                      paddingVertical: 7,
                      paddingHorizontal: 8,
                      borderBottomWidth: 1,
                      borderBottomColor: '#e2e8f0',
                      ...(alt ? { backgroundColor: '#f8fafc' } : {}),
                    }}
                  >
                    <View style={col.check}>
                      {/* Tick box for physical check-off during pack/hand-over */}
                      <View
                        style={{
                          width: 9,
                          height: 9,
                          borderWidth: 1,
                          borderColor: '#94a3b8',
                          borderRadius: 1,
                        }}
                      />
                    </View>
                    <Text style={[s.tableCellBold, col.qty]}>{row.quantity}</Text>
                    <View style={col.asset}>
                      <Text style={row.isComponent ? s.tableCell : s.tableCellBold}>
                        {row.isComponent ? `↳ ${row.description}` : row.description}
                      </Text>
                      {row.makeModel && (
                        <Text style={{ fontSize: 8, color: '#6b7280', marginTop: 1 }}>
                          {row.makeModel}
                        </Text>
                      )}
                      {/* Assigned units as a wrapped block — reads far better on paper
                          than one tall column per unit */}
                      {row.units.length > 0 && (
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 3 }}>
                          {row.units.map((u, ui) =>
                            includeSerials && u.barcode && u.serialNumber ? (
                              // Asset tag over serial — stacked so long serials don't
                              // blow the chip width out on a dense list
                              <View key={ui} style={chip}>
                                <Text style={{ fontSize: 7.5, color: '#334155' }}>{u.barcode}</Text>
                                <Text style={{ fontSize: 6.5, color: '#64748b' }}>
                                  S/N {u.serialNumber}
                                </Text>
                              </View>
                            ) : (
                              <Text key={ui} style={chip}>
                                {u.barcode || u.serialNumber}
                              </Text>
                            )
                          )}
                        </View>
                      )}
                    </View>
                    <View style={col.assigned}>
                      {(row.isAsset || row.units.length > 0) && (
                        <Text
                          style={{
                            fontSize: 9,
                            fontFamily: complete ? 'Helvetica' : 'Helvetica-Bold',
                            color: complete ? '#6b7280' : '#b45309',
                          }}
                        >
                          {row.units.length} of {row.quantity}
                        </Text>
                      )}
                    </View>
                  </View>
                )
            }

            // The category heading travels with its first row so a heading never
            // strands alone at the foot of a page.
            const [firstRow, ...restRows] = group.rows
            return (
              <View key={group.category}>
                <View wrap={false}>
                  {hasCategories && (
                    <View
                      style={{ flexDirection: 'row', backgroundColor: '#f3f4f6', paddingVertical: 3, paddingHorizontal: 6 }}
                    >
                      <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', color: '#374151' }}>
                        {group.category}
                      </Text>
                    </View>
                  )}
                  {firstRow && renderRow(firstRow, 0)}
                </View>
                {restRows.map((row, i) => renderRow(row, i + 1))}
              </View>
            )
          })}
        </View>

        {/* Delivery — keep together */}
        {(data.deliveryMethod || data.deliveryAddress) && (
          <View style={{ marginBottom: 16 }} wrap={false}>
            <Text style={{ fontSize: 10, fontFamily: 'Helvetica-Bold', marginBottom: 6 }}>
              Delivery
            </Text>
            {data.deliveryMethod && (
              <Text style={{ fontSize: 9 }}>Method: {data.deliveryMethod}</Text>
            )}
            {data.deliveryAddress && (
              <Text style={{ fontSize: 9 }}>Address: {data.deliveryAddress}</Text>
            )}
            {data.deliveryDate && <Text style={{ fontSize: 9 }}>Date: {data.deliveryDate}</Text>}
          </View>
        )}

        {/* Notes — keep together */}
        {data.notes && (
          <View style={s.notesSection} wrap={false}>
            <Text style={s.notesSectionTitle}>Notes</Text>
            <Text style={s.notesText}>{data.notes}</Text>
          </View>
        )}

        {/* Footer */}
        <View style={s.footer} fixed>
          <Text style={s.footerText}>
            Generated: {new Date().toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </Text>
          <Text style={s.footerText}>{data.number} - Asset List</Text>
        </View>
      </Page>
    </Document>
  )
}
