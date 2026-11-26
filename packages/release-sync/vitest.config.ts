import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // packing and unpacking real archives is slow on Windows runners
    testTimeout: 30_000,
  },
});
