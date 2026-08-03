"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

/**
 * The audit log's filter bar.
 *
 * Writes the URL rather than holding state, for the same reason the list kit's
 * filter tabs do: the server re-queries, and "every DELETE this user made" is a
 * reading somebody will want to paste into a message. Changing any filter drops
 * the page number, because page 4 of the old result set is nothing in the new
 * one.
 *
 * The options come from the log itself, not from the enums in
 * `lib/actions/audit` — that list names entity types this database has never
 * recorded, and a filter that can only ever return nothing is a dead end.
 */
export function AuditFilters({
  actions,
  entityTypes,
  users,
}: {
  actions: string[];
  entityTypes: string[];
  users: { id: string; name: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function set(key: string, value: string) {
    const params = new URLSearchParams(searchParams);
    if (value) params.set(key, value);
    else params.delete(key);
    params.delete("page");
    const query = params.toString();
    startTransition(() =>
      router.replace(query ? `${pathname}?${query}` : pathname, {
        scroll: false,
      }),
    );
  }

  const filtered =
    !!searchParams.get("action") ||
    !!searchParams.get("entityType") ||
    !!searchParams.get("userId");

  return (
    <div className="flex items-center gap-2" aria-busy={pending}>
      <Picker
        label="Action"
        value={searchParams.get("action") ?? ""}
        onChange={(value) => set("action", value)}
        options={actions.map((value) => ({ value, label: value }))}
        anyLabel="Any action"
      />
      <Picker
        label="Record type"
        value={searchParams.get("entityType") ?? ""}
        onChange={(value) => set("entityType", value)}
        options={entityTypes.map((value) => ({ value, label: value }))}
        anyLabel="Any record"
      />
      <Picker
        label="Who"
        value={searchParams.get("userId") ?? ""}
        onChange={(value) => set("userId", value)}
        options={users.map((user) => ({ value: user.id, label: user.name }))}
        anyLabel="Anyone"
      />
      {filtered ? (
        <button
          type="button"
          onClick={() => {
            const params = new URLSearchParams(searchParams);
            params.delete("action");
            params.delete("entityType");
            params.delete("userId");
            params.delete("page");
            const query = params.toString();
            startTransition(() =>
              router.replace(query ? `${pathname}?${query}` : pathname, {
                scroll: false,
              }),
            );
          }}
          className="rounded-pill bg-sunken px-3 py-1 text-pill text-ink-muted hover:bg-row-hover hover:text-ink"
        >
          Clear
        </button>
      ) : null}
    </div>
  );
}

function Picker({
  label,
  value,
  onChange,
  options,
  anyLabel,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  anyLabel: string;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={`h-[30px] rounded-pill border-0 px-3 text-pill outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        value
          ? "bg-accent-tint-strong text-accent-on-tint"
          : "bg-sunken text-ink-muted"
      }`}
    >
      <option value="">{anyLabel}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
