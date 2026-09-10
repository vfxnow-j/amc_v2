"use client";

import { useState } from "react";
import { QuickQuote } from "@/components/quotes/quick-quote";

/**
 * The way into the Quick Quote dialog.
 *
 * A separate file from the dialog so the thing that has to be a Client
 * Component is only the button. `quick-quote.tsx` pulls in the debounced
 * lookups, the estimate and Radix; a Server Component that only wants to *offer*
 * the action shouldn't have to carry any of it until somebody clicks. The
 * dialog still ships in the same client chunk today — it is imported eagerly,
 * which keeps the first open instant — but the seam is where it needs to be if
 * that ever stops being the right trade.
 *
 * `className` defaults to the dashboard action bar's secondary pill, because
 * that is where this lives; anywhere else can pass its own without this file
 * knowing about it.
 */
export function QuickQuoteButton({
  className = "rounded-pill bg-panel px-4 py-2 text-pill text-ink shadow-sm transition-colors hover:bg-row-hover",
  children = "Quick quote",
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}>
        {children}
      </button>
      <QuickQuote open={open} onOpenChange={setOpen} />
    </>
  );
}
