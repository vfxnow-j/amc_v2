"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SlidersHorizontal } from "lucide-react";
import { Modal, ModalCancel, ModalConfirm } from "@/components/feedback/modal";
import {
  configureLine,
  getLineConfiguration,
  type LineConfiguration,
} from "@/lib/actions/asset-build";
import type { ConfigSlot } from "@/generated/prisma/client";

const MONEY = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const PERIOD: Record<string, string> = { MONTHLY: "mo", WEEKLY: "wk", DAILY: "day", HOURLY: "hr" };
const SLOT_ORDER: ConfigSlot[] = ["GPU", "MEMORY", "STORAGE", "ADDON", "OTHER"];
const SLOT_LABEL: Record<ConfigSlot, string> = {
  GPU: "GPU",
  MEMORY: "Memory",
  STORAGE: "Storage",
  ADDON: "Add-ons",
  OTHER: "Other",
};
/** One choice per machine in these slots; the rest take any number. */
const PICK_ONE: ConfigSlot[] = ["MEMORY", "STORAGE"];

/**
 * Configure a machine on an order (Settings → Configurable items defines what
 * it can take). Memory and storage are one choice each; GPUs and add-ons are
 * ticked with a quantity per machine. The configured price — the machine's rate
 * plus its upgrades — updates as options change, and saving writes the parts
 * under the line and reprices the order.
 */
export function ConfigureLine({ reservationId, itemId }: { reservationId: string; itemId: string }) {
  const router = useRouter();
  const [config, setConfig] = useState<LineConfiguration | null>(null);
  const [chosen, setChosen] = useState<Record<string, number>>({});
  const [error, setError] = useState("");
  const [loading, startLoading] = useTransition();
  const [saving, startSaving] = useTransition();

  function open() {
    setError("");
    startLoading(async () => {
      const loaded = await getLineConfiguration(reservationId, itemId);
      if (!loaded) {
        setError("This machine has nothing to configure it with yet.");
        return;
      }
      setConfig(loaded);
      setChosen(Object.fromEntries(loaded.options.map((option) => [option.optionId, option.selected])));
    });
  }

  function save() {
    if (!config) return;
    startSaving(async () => {
      const result = await configureLine(
        reservationId,
        itemId,
        Object.entries(chosen).map(([optionId, quantity]) => ({ optionId, quantity })),
      );
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      setConfig(null);
      router.refresh();
    });
  }

  const unit = config ? (config.sale ? "" : `/${PERIOD[config.pricingType] ?? ""}`) : "";
  const upgrades = config
    ? config.options.reduce((sum, option) => sum + option.rate * (chosen[option.optionId] ?? 0), 0)
    : 0;

  return (
    <>
      <button
        type="button"
        onClick={open}
        disabled={loading}
        title="Configure this machine"
        className="flex items-center gap-1 rounded-pill bg-sunken px-2 py-[2px] text-micro text-ink hover:bg-row-hover disabled:opacity-50"
      >
        <SlidersHorizontal className="size-3" aria-hidden />
        {loading ? "Loading…" : "Configure"}
      </button>
      {error && !config ? <span className="text-micro text-destructive">{error}</span> : null}

      <Modal
        open={config !== null}
        onOpenChange={(next) => (next ? null : setConfig(null))}
        wide
        title={config ? `Configure ${config.name}` : "Configure"}
        blurb={
          config
            ? `${config.quantity > 1 ? `${config.quantity} machines — choices apply to each. ` : ""}Base parts are included in its rate; upgrades are priced on top.`
            : undefined
        }
        footer={
          <>
            {error ? <span className="mr-auto text-detail text-destructive">{error}</span> : null}
            {config ? (
              <span className="mr-auto text-detail text-ink-muted">
                Configured{" "}
                <span className="font-bold text-ink tabular-nums">
                  {MONEY.format(config.baseRate + upgrades)}
                  {unit}
                </span>{" "}
                each · {MONEY.format(config.baseRate)} base + {MONEY.format(upgrades)} upgrades
              </span>
            ) : null}
            <ModalCancel />
            <ModalConfirm onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save configuration"}
            </ModalConfirm>
          </>
        }
      >
        {config ? (
          <div className="flex flex-col gap-4">
            {SLOT_ORDER.filter((slot) => config.options.some((option) => option.slot === slot)).map((slot) => {
              const options = config.options.filter((option) => option.slot === slot);
              const pickOne = PICK_ONE.includes(slot);
              return (
                <fieldset key={slot}>
                  <legend className="mb-1 text-micro uppercase text-ink-muted">
                    {SLOT_LABEL[slot]}
                    {pickOne ? " · choose one" : ""}
                  </legend>
                  <ul className="flex flex-col gap-px">
                    {options.map((option) => {
                      const count = chosen[option.optionId] ?? 0;
                      const on = count > 0;
                      return (
                        <li
                          key={option.optionId}
                          className={`grid grid-cols-[20px_minmax(0,1fr)_auto_110px] items-center gap-2 rounded-row px-2 py-[6px] text-detail ${
                            on ? "bg-accent-tint/60" : "odd:bg-row-alt"
                          }`}
                        >
                          <input
                            id={`opt-${option.optionId}`}
                            type={pickOne ? "radio" : "checkbox"}
                            name={pickOne ? `slot-${slot}` : undefined}
                            checked={on}
                            disabled={option.out > 0 && on}
                            onChange={(event) =>
                              setChosen((current) => {
                                const next = { ...current };
                                if (pickOne) {
                                  for (const other of options) next[other.optionId] = 0;
                                }
                                next[option.optionId] = event.target.checked ? Math.max(1, option.defaultQuantity) : 0;
                                return next;
                              })
                            }
                            className="size-4 accent-accent-solid"
                          />
                          <label htmlFor={`opt-${option.optionId}`} className="min-w-0 cursor-pointer">
                            <span className="block truncate font-bold">{option.name}</span>
                            <span className="block text-micro text-ink-faint">
                              {option.base ? "base" : "upgrade"}
                              {option.tracked ? " · scanned out with the machine" : ""}
                              {option.out > 0 ? ` · ${option.out} out with client` : ""}
                            </span>
                          </label>
                          {!pickOne && on ? (
                            <input
                              aria-label={`${option.name} per machine`}
                              inputMode="numeric"
                              value={count}
                              onChange={(event) => {
                                const value = Math.max(option.out > 0 ? 1 : 0, Number(event.target.value.replace(/[^\d]/g, "")) || 0);
                                setChosen((current) => ({ ...current, [option.optionId]: Math.min(value, 16) }));
                              }}
                              className="h-7 w-12 rounded-well border border-hairline bg-sunken px-2 text-right tabular-nums outline-none"
                            />
                          ) : (
                            <span />
                          )}
                          <span className="text-right tabular-nums text-ink-muted">
                            {option.included || option.rate === 0 ? "included" : `+${MONEY.format(option.rate)}${unit}`}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                  {pickOne && options.every((option) => (chosen[option.optionId] ?? 0) === 0) ? (
                    <p className="pt-1 text-micro text-ink-faint">None chosen — the quote lists no {SLOT_LABEL[slot].toLowerCase()}.</p>
                  ) : null}
                </fieldset>
              );
            })}
            {config.otherParts.length > 0 ? (
              <p className="text-micro text-ink-faint">
                Also on this line, unchanged: {config.otherParts.map((part) => `${part.quantity}× ${part.name}`).join(", ")}.
              </p>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </>
  );
}
