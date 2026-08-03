/**
 * Temporary kill switch for the second factor at sign-in.
 *
 * v2's users were restored from v1 carrying v1's MFA state, which locks six of
 * the nine accounts out of this instance:
 *
 *   - TOTP accounts store a secret encrypted under v1's MFA_ENCRYPTION_KEY.
 *     v2 has its own key, so `decryptSecret` cannot read them.
 *   - Email-OTP accounts need Resend, and RESEND_API_KEY is blank here, so no
 *     code is ever delivered.
 *
 * With this off, sign-in is email and password only. Nothing about MFA has been
 * removed — enrollment, TOTP, email OTP and trusted devices are all intact and
 * `mfaEnabled` on the user rows is untouched; the login flow simply stops
 * asking. Set AUTH_MFA=on in .env to put the second factor back, once the
 * accounts have re-enrolled against v2's key and outbound email is configured.
 *
 * Server-only: read from the credentials provider and from
 * `validateCredentials`, never from the browser. The login form learns whether
 * a second factor is wanted from `validateCredentials`'s result.
 */
export function isMfaEnforced(): boolean {
  return process.env.AUTH_MFA === 'on'
}
