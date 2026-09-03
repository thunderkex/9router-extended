import { defineConfig } from "vitest/config";
import { resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const openSseDir = resolve(__dirname, "../open-sse").replace(/\\/g, "/");
const srcDir = resolve(__dirname, "../src").replace(/\\/g, "/");

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["**/*.test.js"],
    // Don't scan into git worktrees nested under .claude/ — they carry their
    // own copies of the test files but lack an installed node_modules (open-sse,
    // etc.), which makes provider imports fail during collection.
    exclude: ["**/node_modules/**", "**/.claude/**", "**/dist/**"],
    // Allow many it.concurrent cases (real provider smoke runs ~50 providers in parallel)
    maxConcurrency: 60,
    // Suppress noisy console output from handlers under test
    silent: false,
    server: {
      deps: {
        inline: [/open-sse/, /src/],
      },
    },
  },
  resolve: {
    alias: [
      { find: /^open-sse\/(.*)/, replacement: `${openSseDir}/$1` },
      { find: /^open-sse$/, replacement: `${openSseDir}/index.js` },
      { find: "open-sse", replacement: openSseDir },
      { find: /^@\/(.*)/, replacement: `${srcDir}/$1` },
      { find: "@", replacement: srcDir },
    ],
  },
});
