import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // PoB integration tests boot LuaJIT workers (~2.5 s each) and load builds
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
