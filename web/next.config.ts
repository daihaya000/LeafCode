import type { NextConfig } from "next";
import { execFileSync } from "node:child_process";

function resolveBuildCommit(): string {
  const fromEnv = process.env.GIT_COMMIT || process.env.VERCEL_GIT_COMMIT_SHA;
  if (fromEnv) return fromEnv;

  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function resolveBuildCommitDate(commit: string): string {
  const fromEnv = process.env.GIT_COMMIT_DATE;
  if (fromEnv) return fromEnv;
  if (!commit) return "";

  try {
    return execFileSync("git", ["show", "-s", "--format=%cI", commit], {
      encoding: "utf8",
    }).trim();
  } catch {
    return "";
  }
}

const buildCommit = resolveBuildCommit();
const buildCommitDate = resolveBuildCommitDate(buildCommit);

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_BUILD_COMMIT: buildCommit,
    NEXT_PUBLIC_BUILD_COMMIT_DATE: buildCommitDate,
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
