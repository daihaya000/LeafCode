import type { NextConfig } from "next";
import { execFileSync } from "node:child_process";
import { hostname } from "node:os";
import { join } from "node:path";
import { normalizeWebuiEnv } from "../scripts/lib/env-compat.mjs";
import { resolveNextDistDir } from "./src/lib/dist-dir";

// Legacy OPENCODE_WEBUI_* env vars keep working: copy them onto LEAFCODE_*
// before anything reads them (build-time and runtime).
normalizeWebuiEnv();

// Production builds and `next start` run from the build mirror, which has no
// .git; the installation it was mirrored from does (see install-root.ts).
const gitCwd = process.env.LEAFCODE_INSTALL_ROOT?.trim() || undefined;

function resolveBuildCommit(): string {
  const fromEnv = process.env.GIT_COMMIT || process.env.VERCEL_GIT_COMMIT_SHA;
  if (fromEnv) return fromEnv;

  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", cwd: gitCwd }).trim();
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
      cwd: gitCwd,
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
    NEXT_PUBLIC_LEAFCODE_WORKFLOW_MODE: process.env.LEAFCODE_WORKFLOW_MODE ?? "false",
    NEXT_PUBLIC_LEAFCODE_WORKFLOW_GRAPH: process.env.LEAFCODE_WORKFLOW_GRAPH ?? "false",
    NEXT_PUBLIC_LEAFCODE_WORKFLOW_GRAPH_EDIT: process.env.LEAFCODE_WORKFLOW_GRAPH_EDIT ?? "false",
    NEXT_PUBLIC_HOST_NAME: process.env.COMPUTERNAME || hostname(),
  },
  serverExternalPackages: ["better-sqlite3"],
  // Always inside this project: Turbopack rejects a distDir that navigates out
  // of it. Production builds get their isolation from running in the hard-link
  // mirror instead (scripts/web-build-mirror.mjs). NEXT_DIST_DIR only separates
  // the in-project variants — `.next-dev`, `.next-e2e` — from `.next`.
  distDir: resolveNextDistDir(process.env, __dirname),
  turbopack: {
    // tsconfig `paths` maps bare packages to web/node_modules so repo-root
    // `addons/` can resolve them (see tsconfig.json). Turbopack applies those
    // mappings to runtime resolution too, which sends `react` to the
    // types-only @types package and fails the build. tsc still needs the
    // @types mapping, so the runtime target is corrected here instead.
    resolveAlias: {
      react: "./node_modules/react",
      "react-dom": "./node_modules/react-dom",
      "react/jsx-runtime": "./node_modules/react/jsx-runtime",
    },
  },
  // Pin the file-tracing root to the repo root (one level up: addons/ lives
  // there and is imported via `@addons/*`, see externalDir below). Without
  // this, Next.js's own heuristic walks up from this directory looking for
  // ANY package-lock.json/yarn.lock/pnpm-lock.yaml to guess a monorepo root.
  // The repo root has a package.json but no lockfile of its own, so on a
  // machine where an unrelated lockfile happens to sit further up (observed:
  // a stray `package-lock.json` directly in the user's home directory), Next
  // picks that as the root instead and traces the entire user profile during
  // `next build`, including permission-restricted folders such as
  // `AppData\Roaming\Microsoft\Windows\Start Menu\...` - failing the build
  // with EPERM on scandir. Pinning the root here makes the build's traced
  // scope deterministic regardless of what other lockfiles a machine's user
  // profile happens to contain above the repository.
  outputFileTracingRoot: join(__dirname, ".."),
  // Compile repo-root `addons/` imported via `@addons/*`
  experimental: {
    externalDir: true,
  },
};

export default nextConfig;
