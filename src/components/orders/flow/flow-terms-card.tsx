import { Card, CardEmpty, Field, Unset } from "@/components/record/record-card";
import { dayYear, moneyExact } from "@/lib/format";
import { getFlowRecord } from "@/lib/queries/flow-record";
import { FlowTermsEditor, MarkAutopaySetUp } from "@/components/orders/flow/flow-terms-editor";

/**
 * A Flow order's subscription terms: how long, what it pays now and next, when
 * it steps, what an extension costs — and what the client agreed to.
 *
 * Ported from v1's flow-terms-card. The figures are priced on every render from
 * the order's lines and stored knobs (lib/queries/flow-record.ts), so they are
 * the numbers the repricer stored, never a second calculation.
 */
export async function FlowTermsCard({ id, canEdit }: { id: string; canEdit: boolean }) {
  const record = await getFlowRecord(id);
  if (!record) return null;
  const { terms, agreement, knobs, lock } = record;

  if (!terms || !knobs) {
    return (
      <Card title="Flow terms">
        <CardEmpty>{record.problem ?? "This Flow order cannot be priced yet."}</CardEmpty>
      </Card>
    );
  }

  return (
    <Card
      title="Flow terms"
      meta={
        terms.feasible
          ? `${terms.periodsBilled} of ${terms.termMonths} billed`
          : <span className="font-bold text-destructive">Not billable</span>
      }
      action={
        canEdit ? (
          <FlowTermsEditor
            id={id}
            knobs={knobs}
            lock={lock}
            defaultExtensionPct={record.defaultExtensionPct}
          />
        ) : undefined
      }
    >
      {record.problem ? (
        <p className="px-4 pb-3 text-detail font-bold text-destructive">{record.problem}</p>
      ) : null}
      <div className="grid grid-cols-2 gap-3 px-4 pb-3">
        <Field label="Term">{terms.termMonths} months</Field>
        <Field label="Contract">{moneyExact(terms.contractValue)}</Field>
        <Field label="Starts">{dayYear(terms.start)}</Field>
        <Field label="Ends">{dayYear(terms.end)}</Field>
        <Field label="Current rate">
          {moneyExact(terms.currentRate)}/mo
          <span className="block text-micro text-ink-faint">month {terms.currentMonth}</span>
        </Field>
        <Field label="Next rate">
          {terms.next ? (
            <>
              {moneyExact(terms.next.rate)}/mo
              <span className="block text-micro text-ink-faint">
                from month {terms.next.month} · {dayYear(terms.next.date)}
              </span>
            </>
          ) : (
            <Unset>No further step</Unset>
          )}
        </Field>
        <Field label="Steps down at">
          {terms.stepMonths.length ? (
            `month ${terms.stepMonths.join(", ")}`
          ) : (
            <Unset>Never — one rate</Unset>
          )}
          {terms.termMonths > 12 ? (
            <span className="block text-micro text-ink-faint">
              {terms.stepPct != null
                ? `month 13 set to ${terms.stepPct}% of year one`
                : terms.impliedStepPct != null
                  ? `recover-by shape: month 13 pays ${terms.impliedStepPct}% of year one`
                  : "recover-by shape"}
            </span>
          ) : null}
        </Field>
        <Field label="Extension">
          {terms.extensionPct}% of the final payment
          <span className="block text-micro text-ink-faint">
            {terms.extensionMonthly != null ? `${moneyExact(terms.extensionMonthly)}/mo` : "not rendered"}
            {terms.extensionIsDefault ? " · the default" : " · set on this order"}
          </span>
        </Field>
      </div>

      {/* What the client agreed to, and the one thing left to do about it. */}
      <div className="mx-4 mb-3 flex flex-col gap-2 rounded-well bg-sunken p-3 text-detail">
        {agreement.acceptedAt ? (
          <p>
            <span className="font-bold">
              Terms v{agreement.version ?? "?"} agreed {dayYear(agreement.acceptedAt)}
            </span>
            {agreement.signer ? ` by ${agreement.signer}` : " (approved internally)"}
          </p>
        ) : (
          <p className="text-ink-muted">
            Not agreed yet — the terms freeze onto the order when it is approved.
          </p>
        )}
        <p className="text-ink-muted">
          Autopay: {agreement.autopayLabel.toLowerCase()}
          {agreement.autopaySetupAt
            ? ` · set up ${dayYear(agreement.autopaySetupAt)}${agreement.setupBy ? ` by ${agreement.setupBy}` : ""}`
            : ""}
        </p>
        {agreement.autopayTodo ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-well bg-[var(--warning)] px-3 py-2 text-[var(--warning-on)]">
            <span className="font-bold">Set up autopay in the billing system</span>
            {canEdit ? <MarkAutopaySetUp id={id} /> : null}
          </div>
        ) : null}
        {lock ? <p className="text-micro text-ink-faint">Locked: {lock}</p> : null}
      </div>

      <p className="px-4 pb-4 text-detail text-ink-muted">
        Gear returns to stock at term end — Flow has no buyout.
      </p>
    </Card>
  );
}
