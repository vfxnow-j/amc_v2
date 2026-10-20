"use client";

import { useEffect } from "react";
import { recordQuoteView } from "@/lib/actions/quote-tokens";

/**
 * Tells the server the client has the quote open.
 *
 * Runs in the browser after the page has rendered, which is the point: a mail
 * scanner that only fetches the URL never executes this, so it can't read as
 * the client opening their quote. The server decides whether it counts (staff,
 * previews and reloads do not). Nothing here may ever show an error.
 */
export function ViewBeacon({ token }: { token: string }) {
  useEffect(() => {
    recordQuoteView(token).catch(() => {});
  }, [token]);
  return null;
}
