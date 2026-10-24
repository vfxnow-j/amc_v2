# Quote expiry and copied-link tracking — design

Date: 2026-10-23. Status: decisions made with the owner (7-day default, expiry settable in the Send dialog, expired page with a refresh request). Awaiting spec review.

## Problems (as found in code)
1. A link copied from the Send quote dialog is never marked sent (`QuoteToken.sentAt` stays null), and `countsAsView` (lib/quotes/quote-view.ts) ignores links with no `sentAt`. So views of a link pasted into the owner's own email are not counted and the "quote viewed" notice never fires.
2. No screen sets the quote expiry. `generateQuoteToken` stamps `Reservation.quoteExpiresAt` = today + 30 days (`TOKEN_EXPIRY_DAYS`) on first mint. `updateReservation` can store a new date, but nothing calls it for this, and existing `QuoteToken.expiresAt` values would not follow it (the link's real cutoff is the token's).
3. An expired link shows plain text with no action (app/quote/[token]/page.tsx).

## Changes

### A. Copied link counts as sent
- The Send dialog already holds the minted link. On confirm with no email address, pass that link's token to `sendOrderQuote`; `deliverQuote` stamps that token `sentAt = now`, `sentTo = "Copied by <user name>"`. Only that token: other tokens minted by earlier dialog opens stay unsent.
- Stage move is unchanged (`markQuoteSent` from Draft/Revision).
- Dialog wording: the confirm button reads "Mark as sent" when no address is entered, "Send quote" when there is one. The blurb states that a copied link is tracked once confirmed.
- Views then count through the existing `recordQuoteView` and fire the existing "viewed" email. No change to `countsAsView`.

### B. Expiry
- Default validity becomes **7 days** (`TOKEN_EXPIRY_DAYS = 7`); applies to quotes whose expiry is unset or already past when a link is minted. Existing quotes with a date set keep it.
- The Send dialog gets an **Expires** date field (shows the date in force), with quick picks: 24 hours, 3 days, 7 days, 14 days, 30 days. The pick is saved before the link is shown, so the copied link, the email, the PDF and the order all show one date.
- The same field is editable on the order while the status is Draft, Revision or Quote sent.
- New action `setQuoteExpiry(reservationId, date)` (editors only; refuses a past date; refuses unless status is Draft, Revision or Quote sent): updates `Reservation.quoteExpiresAt`, then sets `expiresAt` of every unused `QuoteToken` for that order to end-of-day UTC on the new date, in one transaction. Audited (`UPDATE`, `Reservation`).
- Shortening below now is refused; to kill a link, mark the quote lost or revise it, as today.

### C. Expired link and refresh request
- Expired link page shows: "This quote expired on {date}. Pricing may have changed." and a **Request an updated quote** button. No prices are shown.
- The button calls a public action `requestQuoteRefresh(token)`: validates the token exists (expired is fine; a used token is refused), rate-limited to one request per token per 24 hours, sets `actionRequired` with note "Client asked for a refreshed quote", and emails the `reservations` recipients using the existing notification recipients mechanism (as `recordQuoteView` does).
- Staff answer by extending the date (B) or reviving through Revision; extending reopens the same link, since the token's cutoff moves.

### D. Link while the order is in Revision (staff-initiated)
- When the order status is `REVISION` and the token is unused (staff pulled it back; a client-requested revision already closes the link), the client page shows a holding page instead of the quote: "This quote is being updated. Please check back soon — we'll send a revised quote." plus the order number and the account manager contact. No lines, prices or totals, no Approve / Request changes / Decline, no PDF link.
- Server side: `approveQuote`, `requestQuoteChanges` and `denyQuote` refuse while the status is `REVISION` (verify each; add the check where missing), so a stale open tab cannot approve a half-edited quote.
- The same link works again once the revised quote is sent; re-sending moves the status to Quote sent and nothing else is needed. If the owner extends expiry while revising, that applies as in B.
- This is the simple version of the queued "online quote lock" (memory: vfxnow-v2-online-quote-lock-idea). The fuller version, showing the last-sent version frozen as a snapshot during revision, stays queued.
- Staff preview (`/quote/preview/[id]`) is unchanged: staff still see the live quote.

## Out of scope
- Per-client default validity, reminder emails before expiry, auto-marking expired quotes lost (Forecast already flags `quoteExpired`).

## Tests
- Pure: a helper `expiryFromChoice(choice, now)` (24h/3d/7d/14d/30d → end-of-day UTC date) and `canSetExpiry(status, date, now)`, in `src/lib/quotes/expiry.ts` with `expiry.test.ts`.
- Pure: `countsAsView` gains a case showing a token stamped sent at confirm now counts.
- By hand on a throwaway order: copy link → Mark as sent → open the link in a private window → view count 1 and notice; change expiry → the live token's cutoff moves; wait-less check of the expired page by setting the date to yesterday directly in the database on the throwaway order.
