import type { NextConfig } from "next";
import { execSync } from "node:child_process";

function resolveBuildCommit(): string {
  const fromEnv = process.env.GIT_COMMIT || process.env.VERCEL_GIT_COMMIT_SHA;
  if (fromEnv) return fromEnv;

  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

const buildCommit = resolveBuildCommit();

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_BUILD_COMMIT: buildCommit,
  },
  serverExternalPackages: ["better-sqlite3"],
  // Keep `next dev` from clobbering the production build the tray host serves
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Compile repo-root `addons/` imported via `@addons/*`
  experimental: {
    externalDir: true,
  },
};

export default nextConfig;
