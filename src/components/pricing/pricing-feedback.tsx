"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { Notice } from "@/components/feedback/notice";
import type { PricingOutcome } from "@/lib/actions/pricing";

/**
 * One place for the table to say what happened.
 *
 * Every price on the screen is independently editable, so a refusal has to land
 * somewhere — and it cannot land in the cell. The rows are a CSS grid with
 * fixed tracks, and a message inside a track either clips or shoves the column
 * widths around for every other row on the page.
 *
 * So the cells report up here and one strip above the table shows the last
 * thing that happened. This is a client provider wrapping server-rendered
 * children: the table itself stays a Server Component doing its own query, and
 * only the leaves that need to talk are client code.
 *
 * Deliberately not `sonner`. It is a dependency here and `components/ui/sonner`
 * exists, but no `<Toaster />` is mounted anywhere in the app, so a `toast()`
 * call today renders nothing at all — several screens already fire into that
 * void. Mounting one is somebody's decision to make on purpose, not a thing to
 * do sideways inside a pricing screen.
 */

type Feedback = { report: (outcome: PricingOutcome) => void };

const FeedbackContext = createContext<Feedback | null>(null);

export function usePricingFeedback(): Feedback {
  // Cells render inside the provider in this screen, but a cell reused
  // elsewhere shouldn't crash for want of one — it just says nothing.
  return useContext(FeedbackContext) ?? { report: () => {} };
}

export function PricingFeedback({ children }: { children: ReactNode }) {
  const [outcome, setOutcome] = useState<PricingOutcome | null>(null);

  return (
    <FeedbackContext value={{ report: setOutcome }}>
      {outcome && outcome.message !== "Unchanged." ? (
        <Notice tone={outcome.status === "error" ? "error" : "ok"} className="mb-3">
          {outcome.message}
        </Notice>
      ) : null}
      {children}
    </FeedbackContext>
  );
}
