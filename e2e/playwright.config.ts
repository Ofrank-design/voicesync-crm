import { defineConfig } from "@playwright/test";
import path from "node:path";

// Set CHROMIUM_PATH to use a specific Chromium binary; otherwise Playwright's own browser is used (npx playwright install chromium).
const exe = process.env.CHROMIUM_PATH;
const audio = path.resolve(__dirname, "fixtures/voice-note.wav");
export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.WEB_URL ?? "http://localhost:3000",
    screenshot: "only-on-failure",
    launchOptions: {
      executablePath: exe,
      args: ["--no-sandbox", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${audio}`, ...(process.env.CHROMIUM_EXTRA_ARGS?.split(" ").filter(Boolean) ?? [])],
    },
  },
});
