/**
 * What a unit may be offered to a client as (`AssetUnit.offeredAs`). Plain
 * module so client components and the portal can share the list and labels.
 */

export const UNIT_OFFERINGS = ['RENTAL', 'SALE', 'FLOW', 'RENT_TO_OWN'] as const
export type UnitOfferingValue = (typeof UNIT_OFFERINGS)[number]

export const UNIT_OFFERING_LABEL: Record<UnitOfferingValue, string> = {
  RENTAL: 'Rental',
  SALE: 'Sale',
  FLOW: 'Flow',
  RENT_TO_OWN: 'Rent-to-own',
}

export const UNIT_OFFERING_HINT: Record<UnitOfferingValue, string> = {
  RENTAL: 'rented by the day, week or month',
  SALE: 'sold outright — typically aged units',
  FLOW: 'placed on a Flow term',
  RENT_TO_OWN: 'staff orders only — never shown in the portal',
}

/** The portal solution each offering feeds (docs/portal-api.md). Rent-to-own feeds none. */
export const OFFERING_FOR_SOLUTION = { rental: 'RENTAL', sale: 'SALE', flow: 'FLOW' } as const
