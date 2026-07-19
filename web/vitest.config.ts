import { defineConfig } from "vitest/config";
import path from "node:path";
import { createRequire } from "node:module";

const webRoot = __dirname;
const repoRoot = path.resolve(webRoot, "..");
const require = createRequire(path.join(webRoot, "package.json"));

function pkg(name: string): string {
  return path.dirname(require.resolve(`${name}/package.json`));
}

// Unit tests only. Playwright E2E specs live under e2e/ and run via `npm run e2e`.
export default defineConfig({
  root: webRoot,
  resolve: {
    alias: {
      "@": path.resolve(webRoot, "src"),
      "@addons": path.resolve(repoRoot, "addons"),
      // Addon sources live outside `web/`; force deps to resolve from web/node_modules.
      react: pkg("react"),
      "react-dom": pkg("react-dom"),
      "react/jsx-runtime": path.join(pkg("react"), "jsx-runtime.js"),
      "react/jsx-dev-runtime": path.join(pkg("react"), "jsx-dev-runtime.js"),
      "lucide-react": pkg("lucide-react"),
      "@testing-library/react": pkg("@testing-library/react"),
    },
  },
  server: {
    fs: {
      allow: [repoRoot],
    },
  },
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "react",
  },
  test: {
    include: [
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
      "../addons/**/*.test.ts",
      "../addons/**/*.test.tsx",
    ],
    environment: "jsdom",
  },
});
