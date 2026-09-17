/**
 * How a client is named on operational screens: the company, when one is
 * recorded, over the contact — "Sundance Institute", not the producer who
 * emailed (owner, 2026-09-17: it is how the business talks about work). Many
 * clients hold the company in `name` with no `companyName`; they read as is.
 */
export function clientLabel(client: { name: string; companyName?: string | null }): string {
  return client.companyName?.trim() || client.name;
}

/** The contact behind the label, when it differs — for a tooltip. */
export function clientContact(client: { name: string; companyName?: string | null }): string | null {
  return client.companyName?.trim() && client.companyName.trim() !== client.name ? client.name : null;
}
