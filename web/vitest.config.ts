import { defineConfig } from "vitest/config";
import path from "node:path";

// Unit tests only. Playwright E2E specs live under e2e/ and run via `npm run e2e`.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "react",
  },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    environment: "jsdom",
  },
});
