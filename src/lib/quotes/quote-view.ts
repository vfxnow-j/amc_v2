/**
 * Which opens of a quote link count as the client looking at it.
 *
 * The link is the client's only once it has been emailed (`sentAt`), so a
 * preview or a link nobody sent never counts. A reload inside the window is the
 * same look, and a dead link is not a view of anything. Staff are filtered out
 * before this runs, by the session, not by anything on the token.
 */

/** Opens closer together than this are one look. */
export const VIEW_WINDOW_MS = 30 * 60 * 1000;

export type ViewableLink = {
  sentAt: Date | null;
  expiresAt: Date;
  lastViewedAt: Date | null;
};

export function countsAsView(link: ViewableLink, now: Date): boolean {
  if (!link.sentAt) return false;
  if (link.expiresAt < now) return false;
  if (link.lastViewedAt && now.getTime() - link.lastViewedAt.getTime() < VIEW_WINDOW_MS) return false;
  return true;
}

export type LinkViews = {
  sentAt: Date | null;
  sentTo: string | null;
  firstViewedAt: Date | null;
  lastViewedAt: Date | null;
  viewCount: number;
};

export type QuoteActivity = {
  /** Links emailed for the order, all of them. */
  linksSent: number;
  lastSentAt: Date | null;
  lastSentTo: string | null;
  views: number;
  firstViewedAt: Date | null;
  lastViewedAt: Date | null;
};

/** Fold every emailed link of an order into the one line the record shows. */
export function summariseActivity(links: LinkViews[]): QuoteActivity {
  const sent = links.filter((link) => link.sentAt);
  const latest = sent.reduce<LinkViews | null>(
    (best, link) => (!best || link.sentAt! > best.sentAt! ? link : best),
    null,
  );
  const times = (pick: (link: LinkViews) => Date | null) =>
    sent.map(pick).filter((at): at is Date => at !== null).sort((a, b) => a.getTime() - b.getTime());
  const firsts = times((link) => link.firstViewedAt);
  const lasts = times((link) => link.lastViewedAt);
  return {
    linksSent: sent.length,
    lastSentAt: latest?.sentAt ?? null,
    lastSentTo: latest?.sentTo ?? null,
    views: sent.reduce((n, link) => n + link.viewCount, 0),
    firstViewedAt: firsts[0] ?? null,
    lastViewedAt: lasts.at(-1) ?? null,
  };
}
