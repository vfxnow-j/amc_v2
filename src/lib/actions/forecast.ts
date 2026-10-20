'use server'

/**
 * Accounting → Forecast: the owner's call on one open order — count this
 * version, leave it out, or treat it as its own deal. `null` clears the call
 * and hands the order back to the automatic grouping (lib/forecast/groups.ts).
 */
import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth-utils'
import type { ChoiceMode } from '@/lib/forecast/groups'

const MODES: ChoiceMode[] = ['COUNT', 'SKIP', 'SEPARATE']

export async function setForecastChoice(reservationId: string, mode: ChoiceMode | null): Promise<void> {
  const authResult = await requireAdmin()
  if (!authResult.authorized) throw new Error(authResult.error || 'Unauthorized')
  if (mode !== null && !MODES.includes(mode)) throw new Error('Unknown forecast choice')

  if (mode === null) {
    await prisma.forecastChoice.deleteMany({ where: { reservationId } })
  } else {
    await prisma.forecastChoice.upsert({
      where: { reservationId },
      create: { reservationId, mode, updatedById: authResult.userId },
      update: { mode, updatedById: authResult.userId },
    })
  }
  revalidatePath('/dashboard/forecast')
}
