import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  // Keep `next dev` from clobbering the production build the tray host serves
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
