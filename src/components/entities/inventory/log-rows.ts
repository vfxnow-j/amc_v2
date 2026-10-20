import { BUSINESS_TIME_ZONE } from "@/lib/billing/calendar";
import { movementLabel } from "@/lib/entities/nav";

const WHEN = new Intl.DateTimeFormat("en-US", {
  timeZone: BUSINESS_TIME_ZONE, month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
});

type MovementRecord = {
  id: string; type: string; quantity: number; correctsId: string | null; finalToOwner: boolean; occurredAt: Date
  fromLocationId: string | null; toLocationId: string | null; actorUserId: string
  recipient: string | null; destination: string | null; reference: string | null; carrier: string | null; tracking: string | null; notes: string | null
  item: { name: string }; unit: { serial: string | null; ownerTag: string | null } | null; unitId: string | null
}

/** One ledger row as plain strings, ready for a client component (dates already in the business timezone). */
export type LogRow = {
  id: string; label: string; correction: boolean; item: string; unit: string | null; quantity: number | null
  from: string | null; to: string | null; recipient: string | null; destination: string | null
  reference: string | null; shipping: string | null; notes: string | null; who: string; when: string
}

export function toLogRows(movements: MovementRecord[], places: Map<string, string>, people: Map<string, string>): LogRow[] {
  const place = (id: string | null) => (id ? (places.get(id) ?? "Unknown location") : null);
  return movements.map((m) => ({
    id: m.id,
    label: movementLabel(m),
    correction: !!m.correctsId,
    item: m.item.name,
    unit: m.unit ? (m.unit.serial || m.unit.ownerTag || "Unit") : null,
    quantity: m.correctsId || m.unitId ? null : m.quantity,
    from: place(m.fromLocationId),
    to: m.finalToOwner ? "Back to the owner" : place(m.toLocationId),
    recipient: m.recipient,
    destination: m.destination,
    reference: m.reference,
    shipping: [m.carrier, m.tracking].filter(Boolean).join(" · ") || null,
    notes: m.notes,
    who: people.get(m.actorUserId) ?? "Unknown user",
    when: WHEN.format(m.occurredAt),
  }));
}
