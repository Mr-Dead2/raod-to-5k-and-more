import { defineConfig } from "vitest/config";

// Its own config on purpose: the app's vite.config.js loads the Cloudflare
// plugin, which expects a real worker build and throws under the test runner.
// Nothing under test needs a bundler plugin — these are pure modules.
export default defineConfig({
  test: {
    include: ["test/**/*.test.js"],
    environment: "node",
  },
});
