"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Notice } from "@/components/feedback/notice";
import {
  clearTemperaturePin,
  pinTemperature,
  setClientOwner,
  setSeasonalMonths,
  type TrackerResult,
} from "@/lib/actions/tracker";
import { BAND_LABEL, PIN_BANDS, monthLabel, type Band } from "@/lib/tracker/labels";

/**
 * The Relationship card's controls: owner, pin, season.
 *
 * Each writes through `lib/actions/tracker`, which checks the role itself; the
 * props here only decide what is *offered*. Seasonal months are an
 * administrator's call because they change how an account is chased all year.
 */

const input =
  "h-9 min-w-0 rounded-well border-0 bg-sunken px-2 text-detail text-ink outline-none disabled:opacity-50";
const quiet =
  "rounded-pill bg-sunken px-3 py-1 text-pill text-ink hover:bg-row-hover disabled:opacity-50";
const solid =
  "h-9 rounded-pill bg-accent-solid px-4 text-pill text-accent-on-solid disabled:opacity-50";

function isoInDays(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function RelationshipDesk({
  clientId,
  meId,
  ownerId,
  owners,
  pinned,
  seasonalMonths,
  canSeason,
  pinLimitDays,
}: {
  clientId: string;
  meId: string;
  ownerId: string | null;
  owners: { id: string; name: string | null }[];
  pinned: { band: Band; reason: string; until: string } | null;
  seasonalMonths: number[];
  canSeason: boolean;
  pinLimitDays: number;
}) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [pinning, setPinning] = useState(false);
  const [band, setBand] = useState<string>("HOT");
  const [reason, setReason] = useState("");
  const [until, setUntil] = useState(isoInDays(30));
  const [months, setMonths] = useState<number[]>(seasonalMonths);

  function run(work: () => Promise<TrackerResult>, after?: () => void) {
    setError("");
    startTransition(async () => {
      try {
        const result = await work();
        if (!result.ok) {
          setError(result.error);
          return;
        }
        after?.();
        router.refresh();
      } catch {
        setError("That didn't save.");
      }
    });
  }

  const monthsChanged =
    months.length !== seasonalMonths.length || months.some((m) => !seasonalMonths.includes(m));

  return (
    <div className="flex flex-col gap-3 border-t border-hairline px-4 py-3">
      {error ? <Notice tone="error">{error}</Notice> : null}

      <div className="flex items-center gap-2">
        <label htmlFor="account-owner" className="w-16 flex-none text-micro uppercase text-ink-muted">
          Owner
        </label>
        <select
          id="account-owner"
          value={ownerId ?? ""}
          disabled={busy}
          onChange={(event) => run(() => setClientOwner(clientId, event.target.value || null))}
          className={`${input} flex-1`}
        >
          <option value="">Nobody — in the pool</option>
          {owners.map((owner) => (
            <option key={owner.id} value={owner.id}>
              {owner.name ?? owner.id}
            </option>
          ))}
        </select>
        {ownerId !== meId ? (
          <button type="button" disabled={busy} className={quiet} onClick={() => run(() => setClientOwner(clientId, meId))}>
            Claim
          </button>
        ) : null}
      </div>

      {pinned ? (
        <div className="flex items-center gap-2">
          <span className="w-16 flex-none text-micro uppercase text-ink-muted">Pin</span>
          <span className="min-w-0 flex-1 truncate text-detail text-ink-muted">
            {BAND_LABEL[pinned.band]} until {pinned.until}
          </span>
          <button type="button" disabled={busy} className={quiet} onClick={() => run(() => clearTemperaturePin(clientId))}>
            Clear pin
          </button>
        </div>
      ) : pinning ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            run(() => pinTemperature({ clientId, band, reason, until }), () => {
              setPinning(false);
              setReason("");
            });
          }}
        >
          <div className="flex gap-2">
            <select aria-label="Band" value={band} onChange={(e) => setBand(e.target.value)} className={input}>
              {PIN_BANDS.map((value) => (
                <option key={value} value={value}>
                  {BAND_LABEL[value]}
                </option>
              ))}
            </select>
            <input
              type="date"
              aria-label="Pinned until"
              value={until}
              min={isoInDays(0)}
              max={isoInDays(pinLimitDays)}
              onChange={(e) => setUntil(e.target.value)}
              className={`${input} flex-1`}
            />
          </div>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why — e.g. renewal talks under way"
            aria-label="Reason for the pin"
            className={`${input} px-3 placeholder:text-ink-faint`}
          />
          <div className="flex justify-end gap-2">
            <button type="button" className={quiet} onClick={() => setPinning(false)}>
              Cancel
            </button>
            <button type="submit" disabled={busy || !reason.trim()} className={solid}>
              Pin
            </button>
          </div>
        </form>
      ) : (
        <div className="flex items-center gap-2">
          <span className="w-16 flex-none text-micro uppercase text-ink-muted">Pin</span>
          <span className="min-w-0 flex-1 text-detail text-ink-faint">
            Override the band for up to {pinLimitDays} days, with a reason.
          </span>
          <button type="button" className={quiet} onClick={() => setPinning(true)}>
            Pin band
          </button>
        </div>
      )}

      {canSeason ? (
        <div className="flex flex-col gap-2">
          <span className="text-micro uppercase text-ink-muted">Usual booking months</span>
          <div className="flex flex-wrap gap-1">
            {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => {
              const on = months.includes(month);
              return (
                <button
                  key={month}
                  type="button"
                  aria-pressed={on}
                  disabled={busy}
                  onClick={() =>
                    setMonths(on ? months.filter((m) => m !== month) : [...months, month].sort((a, b) => a - b))
                  }
                  className={`w-11 rounded-pill px-2 py-1 text-pill ${
                    on ? "bg-accent-tint font-bold text-accent-on-tint" : "bg-sunken text-ink-muted hover:bg-row-hover"
                  }`}
                >
                  {monthLabel(month)}
                </button>
              );
            })}
          </div>
          {monthsChanged ? (
            <div className="flex justify-end gap-2">
              <button type="button" className={quiet} onClick={() => setMonths(seasonalMonths)}>
                Reset
              </button>
              <button
                type="button"
                disabled={busy}
                className={solid}
                onClick={() => run(() => setSeasonalMonths(clientId, months))}
              >
                Save months
              </button>
            </div>
          ) : (
            <span className="text-detail text-ink-faint">
              For event-based accounts. Outside these months the account rests as Seasonal instead of cooling.
            </span>
          )}
        </div>
      ) : null}
    </div>
  );
}
