import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // SOURCE: Docker copies `.next/standalone`. Vercel's adapter does not; setting
  // standalone there failed looking for next-server.js.nft.json (6 Sep 2026).
  output: process.env.VERCEL ? undefined : "standalone",
  async headers() {
    return [
      {
        // GUESS: UNCALIBRATED GUESS — recordings change only when re-exported; an hour of
        // freshness plus a day of background revalidation keeps repeat visits instant.
        source: "/recordings/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=3600, stale-while-revalidate=86400" }],
      },
    ];
  },
};

export default nextConfig;
