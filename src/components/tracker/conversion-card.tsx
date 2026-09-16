import { Card } from "@/components/record/record-card";
import { ConversionLink } from "@/components/tracker/conversion-link";
import { dayYear } from "@/lib/format";
import { getConversionCandidates } from "@/lib/queries/tracker";
import {
  ASK_CATEGORY_LABEL,
  ASK_STATUS_LABEL,
  INTENT_LABEL,
} from "@/lib/tracker/labels";

/**
 * "From the tracker" on the order record: what this order may be the answer to,
 * and what has already been linked to it.
 *
 * Renders nothing when there is nothing to say, so the ordinary order — no asks,
 * no logged conversations — carries no empty card about a feature it never used.
 */
export async function ConversionCard({ id, canEdit }: { id: string; canEdit: boolean }) {
  const found = await getConversionCandidates(id);
  if (!found) return null;

  const { asks, conversations, linkedAsks, linkedConversations, closed } = found;
  const suggestions = asks.length + conversations.length;
  const linked = linkedAsks.length + linkedConversations.length;
  if (suggestions === 0 && linked === 0) return null;

  return (
    <Card
      title="From the tracker"
      meta={
        suggestions > 0
          ? `${suggestions} to confirm`
          : `${linked} linked`
      }
    >
      {suggestions > 0 ? (
        canEdit ? (
          <ConversionLink
            reservationId={id}
            asks={asks.map((ask) => ({
              id: ask.id,
              label: `${ask.quantity ? `${ask.quantity}× ` : ""}${ask.description}`,
              detail: `${ASK_CATEGORY_LABEL[ask.category]} · ${ASK_STATUS_LABEL[ask.status].toLowerCase()} ask${ask.business === "GPL" ? " · GPL" : ""}`,
            }))}
            conversations={conversations.map((row) => ({
              id: row.id,
              label: row.summary,
              detail: `${row.intent ? INTENT_LABEL[row.intent] : "Conversation"} · ${dayYear(row.occurredAt)}${row.business === "GPL" ? " · GPL" : ""}`,
            }))}
          />
        ) : (
          <p className="px-4 pb-3 text-detail text-ink-muted">
            {suggestions} open {suggestions === 1 ? "item" : "items"} on this account may be what this order
            answers. Someone who can edit orders can link them.
          </p>
        )
      ) : null}

      {linked > 0 ? (
        <div className="px-4 pb-4">
          <p className="mb-1 text-micro uppercase text-ink-muted">Linked to this order</p>
          <ul className="flex flex-col gap-1 text-detail">
            {linkedAsks.map((ask) => (
              <li key={ask.id} className="break-words">
                <span className="font-bold">
                  {ask.quantity ? `${ask.quantity}× ` : ""}
                  {ask.description}
                </span>
                <span className="text-ink-muted">
                  {" "}
                  · {ASK_CATEGORY_LABEL[ask.category]} ask, {ASK_STATUS_LABEL[ask.status].toLowerCase()}
                </span>
              </li>
            ))}
            {linkedConversations.map((row) => (
              <li key={row.id} className="break-words">
                <span className="font-bold">{row.summary}</span>
                <span className="text-ink-muted">
                  {" "}
                  · {row.intent ? INTENT_LABEL[row.intent] : "Conversation"}, {dayYear(row.occurredAt)}
                </span>
              </li>
            ))}
          </ul>
          {closed ? (
            <p className="mt-2 text-detail text-ink-muted">
              This order was lost or canceled, so its asks are closed rather than won.
            </p>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
