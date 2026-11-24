import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // the PoB integration test boots LuaJIT and loads all game data (~3 s)
    testTimeout: 60_000,
  },
});
