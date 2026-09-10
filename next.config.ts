import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `next dev` already listens on every interface, but it blocks cross-origin
  // requests for dev-only assets (HMR, /_next/*) from any host other than the
  // one it was initialised with. These are the addresses this box answers on,
  // so the v2 instance can be reviewed from another machine on the LAN.
  // Add a new entry here if the host's address changes.
  allowedDevOrigins: [
    "10.10.100.80", // LAN
    "172.17.0.1", // docker bridge
    "172.18.0.1", // docker user network
  ],

  /**
   * v1 URLs that v2 no longer has a screen for. Kept as permanent redirects so
   * bookmarks, emailed links and muscle memory all still land somewhere useful
   * — the old paths are recorded in `NavPage.from` in lib/nav/clusters.ts.
   */
  async redirects() {
    return [
      // The check-out/check-in desk is gone: both actions happen on the order,
      // and "what needs hands today" is its own queue.
      { source: "/dashboard/checkout", destination: "/dashboard/calendar", permanent: true },
      { source: "/dashboard/checkin", destination: "/dashboard/calendar", permanent: true },
      // v1's list of what's out. The Reservations hub answers that now.
      {
        source: "/dashboard/checkouts",
        destination: "/dashboard/reservations?view=out-now",
        permanent: true,
      },
      { source: "/dashboard/checkouts/:path*", destination: "/dashboard/reservations", permanent: true },
      // Rate cards moved to Operate → Pricing, 2026-09-09. The record keeps its
      // own URL — only the list was absorbed, as a tab.
      {
        source: "/dashboard/rate-cards",
        destination: "/dashboard/pricing/cards",
        permanent: true,
      },
      // Cloud pricing left Settings for Operate → Pricing, and the read-only
      // Cloud services list was retired with it — browsing a price list on one
      // screen and changing it on another was never worth two screens.
      {
        source: "/dashboard/settings/cloud-products",
        destination: "/dashboard/pricing/cloud",
        permanent: true,
      },
      { source: "/dashboard/cloud", destination: "/dashboard/pricing/cloud", permanent: true },
      { source: "/dashboard/services", destination: "/dashboard/pricing/services", permanent: true },
      // Today's movements folded into Calendar: the grid says when things move,
      // the queues under it say what is late and what is waiting.
      { source: "/dashboard/today", destination: "/dashboard/calendar", permanent: true },
      // "Mobile" named the device, not the job. The job is the same at a packing
      // desk with a gun as it is on a phone in the aisle.
      { source: "/dashboard/mobile", destination: "/dashboard/scan", permanent: true },
    ];
  },
};

export default nextConfig;
