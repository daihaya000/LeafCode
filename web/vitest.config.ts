import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Unit tests only. Playwright E2E specs live under e2e/ and run via `npm run e2e`.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
