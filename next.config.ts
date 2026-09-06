import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // SOURCE: Docker copies `.next/standalone`. Vercel's adapter does not; setting
  // standalone there failed looking for next-server.js.nft.json (6 Sep 2026).
  output: process.env.VERCEL ? undefined : "standalone",
};

export default nextConfig;
