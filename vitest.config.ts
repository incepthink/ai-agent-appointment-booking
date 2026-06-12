import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // better-sqlite3 is a native addon; the forks pool runs each test file in a
    // child process, which is the safest host for native modules and gives us
    // real per-file isolation (a fresh module graph — and so a fresh DB).
    pool: "forks",
    isolate: true,
    environment: "node",
    // setup.ts runs before each test file's imports: it wires dummy env vars and
    // points CLINIC_DB_PATH at a throwaway DB so db.ts opens an isolated file.
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts"],
    // Live-model evals live under evals/ and are run via `npm run eval`, never here.
    exclude: ["evals/**", "node_modules/**", "dist/**"],
    testTimeout: 15_000,
  },
});
