import React from 'react'
import { View, Text } from '@react-pdf/renderer'
import type { RenderedFlowTerms } from '@/lib/pricing/flow-terms'

/**
 * The Flow Subscription Terms, as printed on the Flow quote. Ported from v1
 * (src/components/documents/flow-terms-pdf-section.tsx). Renders whatever terms
 * it is handed — the frozen snapshot once the client has approved.
 */

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n)

export type FlowAutopayLine = { method: string; authorizedBy: string; authorizedAt: string }

export function FlowTermsPdfSection({ terms, autopay }: { terms: RenderedFlowTerms; autopay?: FlowAutopayLine }) {
  return (
    <View style={{ marginTop: 14 }} break>
      <Text style={{ fontSize: 10, fontFamily: 'Helvetica-Bold', marginBottom: 2 }}>Flow Subscription Terms</Text>
      <Text style={{ fontSize: 7, color: '#6b7280', marginBottom: 8 }}>
        Addendum to the VFXnow Rental Terms & Conditions ({terms.generalTermsUrl}) · Terms version {terms.version}
      </Text>
      {terms.clauses.map((c, i) => (
        <View key={i} style={{ marginBottom: 6 }} wrap={false}>
          <Text style={{ fontSize: 8, fontFamily: 'Helvetica-Bold' }}>{i + 1}. {c.title}</Text>
          <Text style={{ fontSize: 8, color: '#374151', lineHeight: 1.35 }}>{c.body}</Text>
        </View>
      ))}
      {terms.cancellationExamples.length > 0 && (
        <View style={{ marginTop: 6 }} wrap={false}>
          <Text style={{ fontSize: 8, fontFamily: 'Helvetica-Bold', marginBottom: 3 }}>
            Early cancellation — examples for this agreement (pre-tax)
          </Text>
          {terms.cancellationExamples.map((e) => (
            <View key={e.afterMonth} style={{ flexDirection: 'row', fontSize: 8, paddingVertical: 1 }}>
              <Text style={{ width: 140 }}>Cancel after month {e.afterMonth}</Text>
              <Text>{fmt(e.fee)}</Text>
            </View>
          ))}
        </View>
      )}
      <Text style={{ fontSize: 8, marginTop: 6 }}>
        Extension after the term: {fmt(terms.extension.monthly)}/month, month-to-month ({terms.extension.pct}% of the final
        payment of {fmt(terms.extension.finalMonthly)}).
      </Text>
      {autopay && (
        <Text style={{ fontSize: 8, marginTop: 6 }}>
          Autopay authorized ({autopay.method === 'ACH' ? 'ACH bank debit' : 'card'}) by {autopay.authorizedBy} on{' '}
          {autopay.authorizedAt}.
        </Text>
      )}
    </View>
  )
}
