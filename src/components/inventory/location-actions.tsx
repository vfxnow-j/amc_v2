"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { Modal, ModalCancel, ModalConfirm } from "@/components/feedback/modal";
import { Notice } from "@/components/feedback/notice";
import {
  addLocation,
  getLocationRemovalPlan,
  removeLocation,
  type LocationOutcome,
  type LocationRemovalPlan,
} from "@/lib/actions/locations";

/**
 * Add and remove, on Inventory → Locations & transfers.
 *
 * Both are dialogs rather than a form on the page: a location is added a few
 * times a year, and a permanent form above the fleet's shelves would spend the
 * screen on the rarest thing anyone does here.
 *
 * Removing asks more than it confirms. A location with units filed at it cannot
 * simply vanish — the units would lose where they are — so the dialog reads what
 * is there when it opens, says how many units and of what, and will not go on
 * until somebody picks where they move to. What the server refuses on (transfer
 * history, purchase orders, audits, locations within it) is shown up front, in
 * place of the destination question, rather than discovered on confirm. See
 * `lib/actions/locations.ts` for why each of those blocks a delete.
 *
 * The outcome lands in one strip above the tables, the same arrangement as
 * `PricingFeedback`: the remove button sits inside a server-rendered row, and a
 * message inside a grid track would clip.
 */

type Feedback = {
  outcome: LocationOutcome | null;
  report: (outcome: LocationOutcome) => void;
};

const FeedbackContext = createContext<Feedback | null>(null);

function useLocationFeedback(): Feedback {
  return useContext(FeedbackContext) ?? { outcome: null, report: () => {} };
}

export function LocationFeedback({ children }: { children: ReactNode }) {
  const [outcome, setOutcome] = useState<LocationOutcome | null>(null);

  return (
    <FeedbackContext value={{ outcome, report: setOutcome }}>
      {children}
    </FeedbackContext>
  );
}

/** Where the last add or remove says what happened. Placed by the page. */
export function LocationNotice() {
  const { outcome } = useLocationFeedback();
  if (!outcome) return null;
  return (
    <Notice tone={outcome.status === "error" ? "error" : "ok"}>
      {outcome.message}
    </Notice>
  );
}

const INPUT =
  "h-9 w-full rounded-well border-0 bg-sunken px-3 text-detail text-ink outline-none placeholder:text-ink-faint";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block min-w-0">
      <span className="mb-[6px] block text-micro uppercase text-ink-muted">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-micro text-ink-faint">{hint}</span> : null}
    </label>
  );
}

const BLANK = { name: "", address: "", description: "", taxRate: "", taxLabel: "" };

export function AddLocationButton() {
  const router = useRouter();
  const { report } = useLocationFeedback();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  const rate = form.taxRate.trim();
  const rateNumber = rate === "" ? null : Number(rate);
  const rateProblem =
    rateNumber !== null && (!Number.isFinite(rateNumber) || rateNumber < 0 || rateNumber >= 100)
      ? "Enter a percentage from 0 to under 100."
      : null;

  function close(next: boolean) {
    if (busy) return;
    setOpen(next);
    if (!next) {
      setForm(BLANK);
      setError(null);
    }
  }

  function confirm() {
    if (!form.name.trim() || rateProblem) return;
    setError(null);
    startTransition(async () => {
      const outcome = await addLocation({
        name: form.name,
        address: form.address,
        description: form.description,
        taxRatePercent: rateNumber,
        taxLabel: form.taxLabel,
      });
      if (outcome.status === "error") {
        setError(outcome.message);
        return;
      }
      report(outcome);
      setOpen(false);
      setForm(BLANK);
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="h-9 flex-none rounded-pill bg-accent-solid px-4 text-pill leading-9 text-accent-on-solid transition-colors hover:bg-accent-800"
      >
        Add location
      </button>
      <Modal
        open={open}
        onOpenChange={close}
        title="Add a location"
        blurb="Somewhere units can be filed and transferred to. Only the name is required."
        footer={
          <>
            <ModalCancel />
            <ModalConfirm
              disabled={busy || !form.name.trim() || Boolean(rateProblem)}
              onClick={confirm}
            >
              {busy ? "Adding…" : "Add location"}
            </ModalConfirm>
          </>
        }
      >
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            confirm();
          }}
        >
          <div className="sm:col-span-2">
            <Field label="Name">
              <input
                autoFocus
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                placeholder="VFXnow NY"
                className={INPUT}
              />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Address">
              <input
                value={form.address}
                onChange={(event) => setForm({ ...form, address: event.target.value })}
                className={INPUT}
              />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Description">
              <input
                value={form.description}
                onChange={(event) => setForm({ ...form, description: event.target.value })}
                className={INPUT}
              />
            </Field>
          </div>
          <Field label="Tax rate" hint={rateProblem ?? "A percentage, e.g. 9.5. Blank for none."}>
            <input
              value={form.taxRate}
              inputMode="decimal"
              aria-invalid={rateProblem ? true : undefined}
              onChange={(event) => setForm({ ...form, taxRate: event.target.value })}
              className={INPUT}
            />
          </Field>
          <Field label="Tax label">
            <input
              value={form.taxLabel}
              onChange={(event) => setForm({ ...form, taxLabel: event.target.value })}
              placeholder="CA Sales Tax 9.5%"
              className={INPUT}
            />
          </Field>
          {/* Enter submits from any field. */}
          <button type="submit" hidden />
        </form>
        {error ? (
          <Notice tone="error" className="mt-3">
            {error}
          </Notice>
        ) : null}
      </Modal>
    </>
  );
}

/**
 * The remove control on a location's row. `relative` lifts it above the row
 * link's stretched overlay, the same trick `CellLink` uses.
 */
export function RemoveLocationButton({ id, name }: { id: string; name: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Remove ${name}`}
        className="relative rounded-pill px-2 py-[2px] text-pill text-ink-muted transition-colors hover:bg-row-hover hover:text-ink"
      >
        Remove
      </button>
      {open ? <RemoveDialog id={id} name={name} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function RemoveDialog({
  id,
  name,
  onClose,
}: {
  id: string;
  name: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const { report } = useLocationFeedback();
  const [plan, setPlan] = useState<LocationRemovalPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [destination, setDestination] = useState("");
  const [busy, startTransition] = useTransition();

  useEffect(() => {
    let live = true;
    getLocationRemovalPlan(id).then((result) => {
      if (!live) return;
      if (result.status === "error") setError(result.message);
      else setPlan(result.plan);
    });
    return () => {
      live = false;
    };
  }, [id]);

  const hasUnits = (plan?.units.total ?? 0) > 0;
  const hasReferences = (plan?.references.length ?? 0) > 0;
  const needsDestination = hasUnits || hasReferences;
  const noWhere = needsDestination && (plan?.destinations.length ?? 0) === 0;
  const ready = plan !== null && !noWhere && (!needsDestination || destination !== "");

  function confirm() {
    if (!ready) return;
    setError(null);
    startTransition(async () => {
      const outcome = await removeLocation(id, needsDestination ? destination : null);
      if (outcome.status === "error") {
        setError(outcome.message);
        return;
      }
      report(outcome);
      onClose();
      router.refresh();
    });
  }

  const units = plan?.units;
  const retired = units ? units.total - units.inFleet : 0;

  return (
    <Modal
      open
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
      title={`Remove ${name}?`}
      blurb={
        !plan
          ? "Checking what is filed here…"
          : needsDestination
            ? "Everything filed here or pointing here moves to the location you choose, then it is deleted."
            : "Nothing is filed here. The location is deleted."
      }
      footer={
        <>
          <ModalCancel />
          <ModalConfirm tone="danger" disabled={busy || !ready} onClick={confirm}>
            {busy
              ? "Removing…"
              : needsDestination
                ? "Move and remove"
                : "Remove location"}
          </ModalConfirm>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {plan && hasUnits ? (
          <>
            <p className="text-detail text-ink">
              <span className="font-bold">
                {units!.total} {units!.total === 1 ? "unit is" : "units are"}
              </span>{" "}
              filed here
              {retired > 0 ? (
                <span className="text-ink-muted">
                  {" "}
                  — {units!.inFleet} in fleet, {retired} retired or sold
                </span>
              ) : null}
              .
            </p>
            <ul className="flex flex-col gap-[2px]">
              {plan.models.map((model, index) => (
                <li
                  key={model.name + index}
                  className={`flex items-baseline gap-2 rounded-row px-2 py-1 text-detail ${
                    index % 2 === 1 ? "bg-row-alt" : ""
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate">{model.name}</span>
                  <span className="tabular-nums text-ink-muted">{model.count}</span>
                </li>
              ))}
              {plan.moreModels > 0 ? (
                <li className="px-2 py-1 text-detail text-ink-faint">
                  and {plan.moreModels} more {plan.moreModels === 1 ? "model" : "models"}
                </li>
              ) : null}
            </ul>
          </>
        ) : null}

        {plan && hasReferences ? (
          <div className="text-detail text-ink">
            <p>Also moving:</p>
            <ul className="mt-1 list-disc pl-5 text-ink-muted">
              {plan.references.map((reference) => (
                <li key={reference}>{reference}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {plan && needsDestination ? (
          noWhere ? (
            <Notice tone="error">
              There is no other location to move them to. Add one first.
            </Notice>
          ) : (
            <Field label="Move them to">
              <select
                value={destination}
                onChange={(event) => setDestination(event.target.value)}
                className={INPUT}
              >
                <option value="">Choose a location…</option>
                {plan.destinations.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
            </Field>
          )
        ) : null}

        {error ? <Notice tone="error">{error}</Notice> : null}
      </div>
    </Modal>
  );
}
