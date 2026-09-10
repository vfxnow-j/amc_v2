"use client";

import { useState, useTransition } from "react";
import {
  recordInvoicePayment,
  type PaymentOutcome,
} from "@/lib/accounting/actions";

const MONEY = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Recording money received, on the invoice it settles.
 *
 * The amount is prefilled with the balance, because settling in full is what
 * happens most of the time and the alternative is retyping a figure that is
 * already on screen.
 *
 * An amount above the balance is refused by the action, not clamped: nothing in
 * the schema can hold an overpayment, so quietly writing the smaller figure
 * would leave the record and the bank statement disagreeing with no trace of
 * why. The refusal names the balance and offers it as a button — a way out
 * rather than a dead end.
 *
 * The date is left blank rather than defaulted to today: rendering `new Date()`
 * in a client component makes the server's timezone and the browser's disagree
 * on the first paint. The action treats blank as now.
 */
export function RecordPaymentPanel({
  invoiceId,
  balance,
}: {
  invoiceId: string;
  balance: number;
}) {
  const [amount, setAmount] = useState(balance.toFixed(2));
  const [date, setDate] = useState("");
  const [method, setMethod] = useState("");
  const [reference, setReference] = useState("");
  const [outcome, setOutcome] = useState<PaymentOutcome | null>(null);
  const [busy, startTransition] = useTransition();

  function send(value: number) {
    startTransition(async () => {
      const result = await recordInvoicePayment(invoiceId, {
        amount: value,
        paymentDate: date || undefined,
        paymentMethod: method,
        reference,
      });
      setOutcome(result);
      if (result.status === "ok") {
        setAmount("");
        setReference("");
      }
    });
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setOutcome(null);
    send(Number(amount));
  }

  return (
    <form onSubmit={submit} className="border-t border-hairline px-4 py-3">
      <p className="pb-2 text-micro uppercase text-ink-muted">Record a payment</p>

      <div className="grid grid-cols-[110px_1fr] gap-2">
        <Input
          label="Amount"
          value={amount}
          onChange={setAmount}
          inputMode="decimal"
          placeholder={balance.toFixed(2)}
          required
        />
        <Input
          label="Received"
          type="date"
          value={date}
          onChange={setDate}
          hint="blank = today"
        />
        <Input
          label="Method"
          value={method}
          onChange={setMethod}
          placeholder="Check, ACH…"
        />
        <Input
          label="Reference"
          value={reference}
          onChange={setReference}
          placeholder="Check or transaction number"
        />
      </div>

      <div className="mt-2 flex items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          className="rounded-pill bg-accent-solid px-4 py-[6px] text-pill text-accent-on-solid transition-colors hover:bg-accent-800 disabled:opacity-60"
        >
          {busy ? "Recording…" : "Record"}
        </button>
        <span className="text-detail text-ink-muted">
          {MONEY.format(balance)} outstanding
        </span>
      </div>

      {outcome ? (
        <div
          role="status"
          className={`mt-2 rounded-well p-2 text-detail ${
            outcome.status === "ok"
              ? "bg-sunken text-ink-muted"
              : "bg-accent-tint text-accent-on-tint"
          }`}
        >
          {outcome.message}
          {outcome.status === "over" ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setAmount(outcome.balance.toFixed(2));
                setOutcome(null);
                send(outcome.balance);
              }}
              className="mt-1 block underline underline-offset-2"
            >
              Record {MONEY.format(outcome.balance)} instead
            </button>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}

function Input({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  inputMode,
  hint,
  required,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  inputMode?: "decimal";
  hint?: string;
  required?: boolean;
}) {
  return (
    <label className="flex flex-col gap-[2px]">
      <span className="text-micro uppercase text-ink-muted">
        {label}
        {hint ? <span className="text-ink-faint"> · {hint}</span> : null}
      </span>
      <input
        type={type}
        value={value}
        required={required}
        inputMode={inputMode}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
        className="rounded-well bg-sunken px-2 py-[5px] text-detail text-ink outline-none placeholder:text-ink-faint focus:ring-1 focus:ring-accent-solid"
      />
    </label>
  );
}
