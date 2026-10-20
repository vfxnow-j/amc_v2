import { prisma } from '@/lib/prisma'
import { shouldAdvanceStatus } from '@/lib/leads/dedupe'

/**
 * A quote reaching the client is what makes a lead "Quoted" (stored as
 * PROSPECT). Saving a draft is not: nothing has been promised to anyone yet.
 *
 * Called from both writers of QUOTE_SENT. Forward only, so a lead that has
 * already been won, lost or bound is left alone, and a second send is a no-op.
 * Never throws: the quote has gone out whether or not the lead could be moved.
 */
export async function advanceLeadOnQuoteSent(reservationId: string, userId?: string | null) {
  try {
    const leads = await prisma.lead.findMany({
      where: { convertedReservationId: reservationId },
      select: { id: true, status: true },
    })
    for (const lead of leads) {
      if (!shouldAdvanceStatus(lead.status, 'PROSPECT')) continue
      await prisma.lead.update({ where: { id: lead.id }, data: { status: 'PROSPECT' } })
      await prisma.leadActivity.create({
        data: {
          leadId: lead.id,
          type: 'STATUS_CHANGE',
          title: `Pipeline advanced: ${lead.status} → PROSPECT`,
          description: 'The quote was sent.',
          metadata: { previousStatus: lead.status, newStatus: 'PROSPECT', reservationId },
          createdById: userId ?? undefined,
        },
      })
    }
  } catch { /* non-critical */ }
}
