"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Modal, ModalCancel, ModalConfirm } from "@/components/feedback/modal";
import { Notice } from "@/components/feedback/notice";
import {
  saveShipping,
  type ShippingDetails,
  type StageOutcome,
} from "@/lib/actions/order-stage";
import {
  BACK_METHODS,
  METHOD_LABEL,
  OUT_METHODS,
  SPEED,
  SPEEDS_FOR,
  shipByDate,
  type ShippingSpeed,
} from "@/lib/orders/shipping";
import { parseDateInput, toDateInput } from "@/lib/billing/calendar";

const DAY = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
import type { DeliveryMethod } from "@/generated/prisma/client";

const FIELD =
  "h-9 w-full rounded-well border-0 bg-sunken px-3 text-detail text-ink outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-ring";

function Label({
  children,
  text,
}: {
  children: React.ReactNode;
  text: string;
}) {
  return (
    <label className="flex flex-col gap-[3px]">
      <span className="text-micro uppercase text-ink-muted">{text}</span>
      {children}
    </label>
  );
}

function MethodPicker({
  value,
  options,
  onChange,
}: {
  value: DeliveryMethod | null;
  options: DeliveryMethod[];
  onChange: (next: DeliveryMethod | null) => void;
}) {
  return (
    <select
      value={value ?? ""}
      onChange={(event) =>
        onChange(event.target.value ? (event.target.value as DeliveryMethod) : null)
      }
      className={FIELD}
    >
      <option value="">Not decided</option>
      {options.map((option) => (
        <option key={option} value={option}>
          {METHOD_LABEL[option]}
        </option>
      ))}
    </select>
  );
}

/**
 * Editing how an order travels.
 *
 * A dialog rather than in-place fields, unlike the pricing catalogue, because
 * saving reprices the order: delivery and return costs run through
 * `applyShippingMargin` into the stored total, and the two costs also sync onto
 * the active package, which is where the client's quote reads them. A change
 * that moves the number on a quote should be a deliberate act with a Save on
 * it, which is the same reasoning as the billing terms dialog next door.
 *
 * The margin is one setting for both legs, not one each, because that is what
 * the column is — `shippingMarginType` and `shippingMargin` are single fields
 * that `computeReservationFinancials` applies to delivery and return alike.
 * Rendering two controls would imply a split the schema cannot keep.
 *
 * Delivery and return dates are deliberately absent. `deliveryDate` and
 * `returnDate` are set by the stage moves when the order actually ships and
 * comes back; letting someone type them here would let the record claim a
 * delivery that never happened. The *ship by* date is different — a plan, not a
 * record — so it is here: worked out from the speed, or typed by hand.
 */
export function EditShipping({
  id,
  shipping,
  startDate,
}: {
  id: string;
  shipping: ShippingDetails;
  /** The order's start, `YYYY-MM-DD` — what the kit has to arrive for. */
  startDate: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(shipping);
  const [outcome, setOutcome] = useState<StageOutcome | null>(null);
  const [busy, startTransition] = useTransition();

  function set<K extends keyof ShippingDetails>(
    key: K,
    value: ShippingDetails[K],
  ) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function save() {
    setOutcome(null);
    startTransition(async () => {
      const result = await saveShipping(id, draft);
      setOutcome(result);
      if (result.status === "ok") {
        setOpen(false);
        router.refresh();
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setDraft(shipping);
          setOutcome(null);
          setOpen(true);
        }}
        className="rounded-pill bg-sunken px-3 py-1 text-pill text-ink hover:bg-row-hover"
      >
        Edit shipping
      </button>

      {outcome && outcome.status === "error" && !open ? (
        <div className="px-4 pb-3">
          <Notice tone="error">{outcome.message}</Notice>
        </div>
      ) : null}

      {open ? (
        <Modal
          open
          onOpenChange={setOpen}
          title="Shipping"
          blurb="How the kit gets there and how it comes back. Saving reprices the order against the two costs."
          footer={
            <>
              <ModalCancel />
              <ModalConfirm onClick={save} disabled={busy}>
                {busy ? "Saving…" : "Save shipping"}
              </ModalConfirm>
            </>
          }
        >
          <div className="flex flex-col gap-4">
            {outcome && outcome.status === "error" ? (
              <Notice tone="error">{outcome.message}</Notice>
            ) : null}

            <div className="flex flex-col gap-2">
              <span className="text-card-title">Going out</span>
              <div className="grid gap-2 sm:grid-cols-2">
                <Label text="Method">
                  <MethodPicker
                    value={draft.deliveryMethod}
                    options={OUT_METHODS}
                    onChange={(next) =>
                      setDraft((current) => ({
                        ...current,
                        deliveryMethod: next,
                        shipSpeed:
                          next && current.shipSpeed && (SPEEDS_FOR[next] ?? []).includes(current.shipSpeed)
                            ? current.shipSpeed
                            : null,
                        shipDate: next === "CUSTOMER_PICKUP" || next === null ? "" : current.shipDate,
                      }))
                    }
                  />
                </Label>
                <Label text="Cost">
                  <input
                    value={draft.deliveryCost || ""}
                    inputMode="decimal"
                    placeholder="0.00"
                    onChange={(event) =>
                      set("deliveryCost", Number(event.target.value) || 0)
                    }
                    className={`${FIELD} text-right tabular-nums`}
                  />
                </Label>
                <Label text="Carrier">
                  <input
                    value={draft.deliveryCourier}
                    placeholder="e.g. FedEx"
                    onChange={(event) =>
                      set("deliveryCourier", event.target.value)
                    }
                    className={FIELD}
                  />
                </Label>
                {(() => {
                  const offered = draft.deliveryMethod ? (SPEEDS_FOR[draft.deliveryMethod] ?? []) : [];
                  if (offered.length === 0) return null;
                  const start = parseDateInput(startDate);
                  const worked = start && draft.shipSpeed ? shipByDate(start, draft.shipSpeed) : null;
                  return (
                    <>
                      <Label text="Speed">
                        <select
                          value={draft.shipSpeed ?? ""}
                          onChange={(event) =>
                            set("shipSpeed", event.target.value ? (event.target.value as ShippingSpeed) : null)
                          }
                          className={FIELD}
                        >
                          <option value="">Not decided</option>
                          {offered.map((speed) => (
                            <option key={speed} value={speed}>
                              {SPEED[speed].label}
                              {SPEED[speed].transitDays > 0 ? ` · ${SPEED[speed].transitDays} business days` : ""}
                            </option>
                          ))}
                        </select>
                      </Label>
                      <Label text="Ship by">
                        <input
                          type="date"
                          value={draft.shipDate || (worked ? toDateInput(worked) : "")}
                          onChange={(event) => set("shipDate", event.target.value)}
                          className={`${FIELD} tabular-nums`}
                        />
                        <span className="text-micro text-ink-faint">
                          {draft.shipDate ? (
                            <>
                              Set by hand.{" "}
                              <button type="button" onClick={() => set("shipDate", "")} className="text-accent-text hover:underline">
                                {worked ? `Use ${DAY.format(worked)} from the speed` : "Clear"}
                              </button>
                            </>
                          ) : worked ? (
                            `Worked out from the ${start ? DAY.format(start) : ""} start. Change it to set it by hand.`
                          ) : (
                            "Choose a speed to work it out, or set a date."
                          )}
                        </span>
                      </Label>
                    </>
                  );
                })()}
                <Label text="Tracking number">
                  <input
                    value={draft.deliveryTrackingNumber}
                    onChange={(event) =>
                      set("deliveryTrackingNumber", event.target.value)
                    }
                    className={`${FIELD} tabular-nums`}
                  />
                </Label>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-card-title">Coming back</span>
              <div className="grid gap-2 sm:grid-cols-2">
                <Label text="Method">
                  <MethodPicker
                    value={draft.returnMethod}
                    options={BACK_METHODS}
                    onChange={(next) => set("returnMethod", next)}
                  />
                </Label>
                <Label text="Cost">
                  <input
                    value={draft.returnCost || ""}
                    inputMode="decimal"
                    placeholder="0.00"
                    onChange={(event) =>
                      set("returnCost", Number(event.target.value) || 0)
                    }
                    className={`${FIELD} text-right tabular-nums`}
                  />
                </Label>
                <Label text="Carrier">
                  <input
                    value={draft.returnCourier}
                    onChange={(event) => set("returnCourier", event.target.value)}
                    className={FIELD}
                  />
                </Label>
                <Label text="Tracking number">
                  <input
                    value={draft.returnTrackingNumber}
                    onChange={(event) =>
                      set("returnTrackingNumber", event.target.value)
                    }
                    className={`${FIELD} tabular-nums`}
                  />
                </Label>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-card-title">Margin</span>
              <p className="text-detail text-ink-muted">
                One setting, applied to both legs — it is a single field on the
                order, not one per direction.
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                <Label text="How">
                  <select
                    value={draft.shippingMarginType ?? ""}
                    onChange={(event) =>
                      set(
                        "shippingMarginType",
                        event.target.value === ""
                          ? null
                          : (event.target.value as "FIXED" | "PERCENTAGE"),
                      )
                    }
                    className={FIELD}
                  >
                    <option value="">Charge at cost</option>
                    <option value="PERCENTAGE">A percentage on top</option>
                    <option value="FIXED">A fixed amount on each leg</option>
                  </select>
                </Label>
                <Label text={draft.shippingMarginType === "PERCENTAGE" ? "Percent" : "Amount"}>
                  <input
                    value={draft.shippingMargin || ""}
                    inputMode="decimal"
                    disabled={draft.shippingMarginType === null}
                    placeholder="0"
                    onChange={(event) =>
                      set("shippingMargin", Number(event.target.value) || 0)
                    }
                    className={`${FIELD} text-right tabular-nums disabled:opacity-50`}
                  />
                </Label>
              </div>
            </div>

            <Label text="Delivery address">
              <textarea
                value={draft.deliveryAddress}
                rows={3}
                onChange={(event) => set("deliveryAddress", event.target.value)}
                className="w-full rounded-well border-0 bg-sunken px-3 py-2 text-detail text-ink outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-ring"
              />
            </Label>

            <Label text="Notes — optional">
              <textarea
                value={draft.deliveryNotes}
                rows={2}
                onChange={(event) => set("deliveryNotes", event.target.value)}
                className="w-full rounded-well border-0 bg-sunken px-3 py-2 text-detail text-ink outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-ring"
              />
            </Label>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
