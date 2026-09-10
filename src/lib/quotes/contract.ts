/**
 * The shapes Quick Quote's server action takes and returns.
 *
 * They live here rather than beside the action because `lib/actions/quick-quote.ts`
 * is a `"use server"` file, and such a file may only export async functions.
 * A type export happens to survive — it is erased before the bundler ever sees
 * it — but the moment one of these grows a companion const (a default term, a
 * list of refusal reasons) that file typechecks, lints, runs in dev and then
 * fails the production build. `lib/settings/pages.ts` records the same lesson
 * from the other direction. The seam is cheaper to draw now than to find later.
 */

import type { DraftLine } from "@/lib/actions/order-builder";

export type QuickQuoteInput = {
  /** An existing client. Quick Quote does not create accounts; the prospect path is separate. */
  clientId: string;
  /** Date-only, `YYYY-MM-DD`, as the date inputs produce them. */
  start: string;
  end: string;
  projectName?: string;
  lines: DraftLine[];
  /**
   * Mark the quote sent and email the link to the client, rather than leaving
   * it as a draft nobody has been shown.
   */
  send?: boolean;
  /** Note carried into the quote email. Ignored when `send` is false. */
  message?: string;
};

/**
 * The established outcome shape in `lib/actions/` — one reading for the screen,
 * a message shown verbatim, and where to go next. See `StageOutcome`.
 */
export type QuickQuoteOutcome =
  | { status: "ok"; message: string; href: string }
  | { status: "error"; message: string };
