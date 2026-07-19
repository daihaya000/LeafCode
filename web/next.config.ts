import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  // Keep `next dev` from clobbering the production build the tray host serves
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Compile repo-root `addons/` imported via `@addons/*`
  experimental: {
    externalDir: true,
  },
};

export default nextConfig;
