import { Card, CardEmpty } from "@/components/record/record-card";
import { AskList } from "@/components/tracker/ask-list";
import { QuickLog } from "@/components/tracker/quick-log";
import { StepDone } from "@/components/tracker/step-done";
import { dayYear } from "@/lib/format";
import { getContactOptions, getConversations } from "@/lib/queries/tracker";
import {
  BUSINESS_LABEL,
  CHANNEL_LABEL,
  INTENT_LABEL,
  NEXT_STEP_LABEL,
  REACH_LABEL,
} from "@/lib/tracker/labels";

/**
 * Every conversation and attempt with an account, what they asked for, and the
 * form to log the next one.
 *
 * On an account this includes whatever was logged on the leads that became it —
 * followed at read time through the lead, so a conversion never has to copy
 * anything and cannot forget to. Those rows say so.
 */
export async function ConversationsCard({
  target,
  canEdit,
}: {
  target: { clientId: string } | { leadId: string };
  canEdit: boolean;
}) {
  const clientId = "clientId" in target ? target.clientId : null;
  const [{ rows, total, asks, openAsks }, contacts] = await Promise.all([
    getConversations(target),
    clientId ? getContactOptions(clientId) : Promise.resolve([]),
  ]);
  const now = new Date();

  return (
    <Card
      title="Conversations"
      meta={total === 0 ? undefined : rows.length < total ? `latest ${rows.length} of ${total}` : `all ${total} shown`}
    >
      {canEdit ? <QuickLog target={target} contacts={contacts} openAsks={openAsks} /> : null}

      <AskList target={target} asks={asks} canEdit={canEdit} />

      {rows.length === 0 ? (
        <CardEmpty>
          No conversations logged yet. Until one is, this account&rsquo;s temperature is read from its
          orders alone — log the next call and it starts counting.
        </CardEmpty>
      ) : (
        <ul className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-2 pb-3">
          {rows.map((row) => {
            const openStep = row.nextStep !== "NONE" && row.nextStepAt && !row.nextStepDoneAt;
            const overdue = openStep && row.nextStepAt! <= now;
            return (
              <li key={row.id} className="rounded-row px-2 py-[6px] text-detail">
                <span className="flex items-baseline gap-2">
                  <span className="flex-none text-micro uppercase text-ink-faint">
                    {CHANNEL_LABEL[row.channel]}
                    {row.business === "GPL" ? ` · ${BUSINESS_LABEL.GPL}` : ""}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-bold">{row.summary}</span>
                  <span className="flex-none tabular-nums text-ink-muted">{dayYear(row.occurredAt)}</span>
                </span>
                <span className="block text-ink-muted">
                  {row.reach === "CONNECTED" && row.intent ? INTENT_LABEL[row.intent] : REACH_LABEL[row.reach]}
                  {row.direction === "INBOUND" ? " · they reached out" : ""}
                  {row.contact ? ` · with ${row.contact.name}` : ""}
                  {clientId && row.leadId ? " · logged while a lead" : ""}
                </span>
                {row.notes ? (
                  <span className="block whitespace-pre-line text-ink-muted">{row.notes}</span>
                ) : null}
                {row.nextStep !== "NONE" && row.nextStepAt ? (
                  <span className="flex items-center gap-2">
                    <span className={overdue ? "font-bold text-accent-text" : row.nextStepDoneAt ? "text-ink-faint line-through" : "text-ink-muted"}>
                      {NEXT_STEP_LABEL[row.nextStep]} · {dayYear(row.nextStepAt)}
                    </span>
                    {openStep && canEdit ? <StepDone interactionId={row.id} /> : null}
                  </span>
                ) : null}
                {row.createdBy ? <span className="block text-ink-faint">{row.createdBy.name}</span> : null}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
