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
};

export default nextConfig;
