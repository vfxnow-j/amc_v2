"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setLineCategory, setLineDescription } from "@/lib/actions/order-stage";

/**
 * The wording of a free-text line, edited in place. Saved on blur or Enter;
 * Escape puts the original back, and a refusal reverts and says why.
 */
export function LineText({
  reservationId,
  itemId,
  text,
}: {
  reservationId: string;
  itemId: string;
  text: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(text);
  const [error, setError] = useState("");
  const [busy, startTransition] = useTransition();

  // Follow the server after a refresh.
  const [seed, setSeed] = useState(text);
  if (seed !== text) {
    setSeed(text);
    setValue(text);
  }

  function commit() {
    const next = value.trim();
    if (next === text) return setValue(text);
    startTransition(async () => {
      const result = await setLineDescription(reservationId, itemId, next);
      if (result.status === "error") {
        setError(result.message);
        setValue(text);
      } else {
        setError("");
        router.refresh();
      }
    });
  }

  return (
    <>
      <input
        value={value}
        disabled={busy}
        aria-label="Line text"
        onChange={(event) => setValue(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            setValue(text);
            event.currentTarget.blur();
          }
        }}
        className="w-full rounded-row border-0 bg-transparent px-1 font-bold text-ink outline-none hover:bg-row-hover focus:bg-sunken disabled:opacity-50"
      />
      {error ? <span className="block text-micro font-normal text-danger">{error}</span> : null}
    </>
  );
}

/** The category a free-text line is grouped under on the order. Blank clears it. */
export function LineCategory({
  reservationId,
  itemId,
  category,
  choices,
}: {
  reservationId: string;
  itemId: string;
  category: string | null;
  /** Categories already used on this order, offered as suggestions. */
  choices: string[];
}) {
  const router = useRouter();
  const current = category ?? "";
  const [value, setValue] = useState(current);
  const [error, setError] = useState("");
  const [busy, startTransition] = useTransition();

  const [seed, setSeed] = useState(current);
  if (seed !== current) {
    setSeed(current);
    setValue(current);
  }

  function commit() {
    const next = value.trim();
    if (next === current) return setValue(current);
    startTransition(async () => {
      const result = await setLineCategory(reservationId, itemId, next);
      if (result.status === "error") {
        setError(result.message);
        setValue(current);
      } else {
        setError("");
        router.refresh();
      }
    });
  }

  const listId = `categories-${itemId}`;
  return (
    <>
      <input
        value={value}
        list={listId}
        disabled={busy}
        aria-label="Category"
        placeholder="Category"
        onChange={(event) => setValue(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            setValue(current);
            event.currentTarget.blur();
          }
        }}
        className="block w-full rounded-row border-0 bg-transparent px-1 text-micro font-normal text-ink-muted outline-none placeholder:text-ink-faint hover:bg-row-hover focus:bg-sunken disabled:opacity-50"
      />
      <datalist id={listId}>
        {choices.map((choice) => (
          <option key={choice} value={choice} />
        ))}
      </datalist>
      {error ? <span className="block text-micro font-normal text-danger">{error}</span> : null}
    </>
  );
}
