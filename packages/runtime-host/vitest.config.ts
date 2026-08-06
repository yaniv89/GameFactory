import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    // The sandbox tests instantiate real WASM QuickJS runtimes and
    // deliberately run hostile code against them (infinite loops, memory
    // bombs) — each of those is slower than typical unit-test work.
    testTimeout: 15000,
  },
});
