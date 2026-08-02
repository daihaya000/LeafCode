import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT) || 3100;
const BASE_URL = `http://127.0.0.1:${PORT}`;

/**
 * Engine-independent smoke E2E: boots the production server and checks the
 * app shell renders. OpenCode does not need to be running.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "line" : "list",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    // Isolated distDir (mirrors NEXT_DIST_DIR in next.config.ts for `next
    // dev`): e2e must never read/write the same `.next` the tray host's
    // production `next start` serves on port 3000, or a build here could
    // corrupt that live service (or vice versa require stopping it first).
    // `npx next build` bypasses the `prebuild` npm-lifecycle guard script
    // (which unconditionally refuses when port 3000 is occupied) — safe
    // here specifically because NEXT_DIST_DIR keeps the output separate.
    command: `npm run sync:addons && npx next build && npm run start -- --hostname 127.0.0.1 --port ${PORT}`,
    env: {
      NEXT_DIST_DIR: ".next-e2e",
      OPENCODE_WEBUI_WORKFLOW_MODE: "true",
      OPENCODE_WEBUI_WORKFLOW_GRAPH: "true",
      OPENCODE_WEBUI_WORKFLOW_GRAPH_EDIT: "false",
    },
    url: BASE_URL,
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
  },
});
