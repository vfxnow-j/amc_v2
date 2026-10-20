/**
 * What each kind of movement does to a unit or to a stock row.
 *
 * Pure on purpose: the actions in lib/actions/entity-inventory.ts load the
 * current state, call this, and write the movement and the resulting state in
 * one transaction. Keeping the rules here means they are tested without a
 * database, and a screen cannot invent a transition this file refuses.
 */
export type UnitStatus = 'IN_STORAGE' | 'DEPLOYED' | 'RETURNED_TO_OWNER'
export type UnitState = { status: UnitStatus; locationId: string | null }

export type MovementInput = {
  type: 'RECEIVE' | 'MOVE' | 'RELEASE' | 'RETURN'
  fromLocationId?: string | null
  toLocationId?: string | null
  recipient?: string | null
  finalToOwner?: boolean
}

export type Applied = { ok: true; next: UnitState } | { ok: false; reason: string }
const no = (reason: string): { ok: false; reason: string } => ({ ok: false, reason })

export function applyUnitMovement(current: UnitState | null, m: MovementInput): Applied {
  switch (m.type) {
    case 'RECEIVE':
      if (current && current.status !== 'RETURNED_TO_OWNER') return no('That unit is already in custody.')
      if (!m.toLocationId) return no('Choose where it is being stored.')
      return { ok: true, next: { status: 'IN_STORAGE', locationId: m.toLocationId } }
    case 'MOVE':
      if (!current || current.status !== 'IN_STORAGE') return no('Only a unit in storage can be moved. A deployed unit has to be returned first.')
      if (!m.toLocationId) return no('Choose where it is going.')
      if (m.toLocationId === current.locationId) return no('It is already there.')
      return { ok: true, next: { status: 'IN_STORAGE', locationId: m.toLocationId } }
    case 'RELEASE':
      if (!current || current.status !== 'IN_STORAGE') return no('Only a unit in storage can be released.')
      if (!m.recipient?.trim()) return no('Say who it is being released to.')
      if (m.finalToOwner) return { ok: true, next: { status: 'RETURNED_TO_OWNER', locationId: null } }
      if (!m.toLocationId) return no('Choose the destination site.')
      return { ok: true, next: { status: 'DEPLOYED', locationId: m.toLocationId } }
    case 'RETURN':
      if (!current || current.status !== 'DEPLOYED') return no('Only a deployed unit can be returned.')
      if (!m.toLocationId) return no('Choose where it is being stored.')
      return { ok: true, next: { status: 'IN_STORAGE', locationId: m.toLocationId } }
  }
}

export type StockRow = { locationId: string; deployed: boolean; quantity: number }
export type StockApplied = { ok: true; rows: StockRow[] } | { ok: false; reason: string }

function adjust(rows: StockRow[], locationId: string, deployed: boolean, delta: number): StockRow[] | null {
  const next = rows.map((r) => ({ ...r }))
  const row = next.find((r) => r.locationId === locationId && r.deployed === deployed)
  if (!row) {
    if (delta < 0) return null
    next.push({ locationId, deployed, quantity: delta })
    return next
  }
  row.quantity += delta
  if (row.quantity < 0) return null
  return next.filter((r) => r.quantity > 0)
}

export function applyStockMovement(rows: StockRow[], m: MovementInput & { quantity: number }): StockApplied {
  if (!Number.isInteger(m.quantity) || m.quantity <= 0) return no('The quantity has to be a whole number above zero.')
  const q = m.quantity
  let out: StockRow[] | null = rows
  const enough = 'There is not that much there.'

  switch (m.type) {
    case 'RECEIVE':
      if (!m.toLocationId) return no('Choose where it is being stored.')
      out = adjust(rows, m.toLocationId, false, q)
      break
    case 'MOVE':
      if (!m.fromLocationId || !m.toLocationId) return no('Choose where from and where to.')
      if (m.fromLocationId === m.toLocationId) return no('It is already there.')
      out = adjust(rows, m.fromLocationId, false, -q)
      if (!out) return no(enough)
      out = adjust(out, m.toLocationId, false, q)
      break
    case 'RELEASE':
      if (!m.fromLocationId) return no('Choose where it is coming from.')
      if (!m.recipient?.trim()) return no('Say who it is being released to.')
      out = adjust(rows, m.fromLocationId, false, -q)
      if (!out) return no(enough)
      if (!m.finalToOwner) {
        if (!m.toLocationId) return no('Choose the destination site.')
        out = adjust(out, m.toLocationId, true, q)
      }
      break
    case 'RETURN':
      if (!m.fromLocationId || !m.toLocationId) return no('Choose where from and where to.')
      out = adjust(rows, m.fromLocationId, true, -q)
      if (!out) return no(enough)
      out = adjust(out, m.toLocationId, false, q)
      break
  }
  return out ? { ok: true, rows: out } : no(enough)
}
