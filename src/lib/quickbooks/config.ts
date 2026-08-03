/**
 * Whether this instance is even able to talk to QuickBooks, without saying
 * anything a screen must not repeat.
 *
 * `qb-client.ts` reads the four environment variables and silently substitutes
 * empty strings, so a missing client id produces a perfectly valid-looking
 * authorise URL that Intuit rejects with a generic error. That failure lands
 * after the browser has left the app, which is the worst place for it: nothing
 * on our side knows it happened, and the person is looking at somebody else's
 * error page.
 *
 * This module exists so the connect route and the settings screen can refuse
 * before that, and say which variable is blank.
 *
 * Nothing here returns a secret. `QB_CLIENT_SECRET` is reported only as present
 * or absent, and never reaches a rendered page — the module is imported by
 * server components and route handlers only.
 */

export type QuickBooksConfig = {
  /** Every variable the OAuth exchange needs is present. */
  configured: boolean;
  /** Names of the blank ones, for a message that says what to fix. */
  missing: string[];
  /** "sandbox" or "production" — which company file a connection would hit. */
  environment: string;
  /** Not a secret: Intuit has to be told this and it must match their console. */
  redirectUri: string;
};

const REQUIRED = [
  "QB_CLIENT_ID",
  "QB_CLIENT_SECRET",
  "QB_REDIRECT_URI",
] as const;

export function quickbooksConfig(): QuickBooksConfig {
  const missing = REQUIRED.filter((name) => !process.env[name]);

  return {
    configured: missing.length === 0,
    missing,
    environment: process.env.QB_ENVIRONMENT || "sandbox",
    redirectUri: process.env.QB_REDIRECT_URI || "",
  };
}
