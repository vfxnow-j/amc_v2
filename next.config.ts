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
      { source: "/dashboard/checkout", destination: "/dashboard/today", permanent: true },
      { source: "/dashboard/checkin", destination: "/dashboard/today", permanent: true },
      // v1's list of what's out. The Reservations hub answers that now.
      {
        source: "/dashboard/checkouts",
        destination: "/dashboard/reservations?view=out-now",
        permanent: true,
      },
      { source: "/dashboard/checkouts/:path*", destination: "/dashboard/reservations", permanent: true },
    ];
  },
};

export default nextConfig;
