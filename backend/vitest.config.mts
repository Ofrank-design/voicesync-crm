import { defineConfig } from "vitest/config";

// Generous limits so slower computers (Windows with antivirus, small laptops, CI) do not fail tests that are simply slow to start.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 120_000,   // the database tests start a real Postgres (WebAssembly) before they run
    maxWorkers: 4,          // too many parallel workers make every test file slower on small machines
  },
});
