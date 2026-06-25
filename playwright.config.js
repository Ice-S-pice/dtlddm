import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  use: {
    baseURL: "http://127.0.0.1:5177",
  },
  webServer: {
    command: "npm run dev -- --port 5177",
    url: "http://127.0.0.1:5177",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
