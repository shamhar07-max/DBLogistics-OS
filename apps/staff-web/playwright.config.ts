import { defineConfig } from '@playwright/test';
import { existsSync, readdirSync } from 'node:fs';
const find = () => { try { const d = readdirSync('/opt/pw-browsers').find((x) => /^chromium-\d+$/.test(x)); const p = d && `/opt/pw-browsers/${d}/chrome-linux/chrome`; return p && existsSync(p) ? p : undefined; } catch { return undefined; } };
export default defineConfig({
  testDir: 'e2e', timeout: 60_000, fullyParallel: false, workers: 1, reporter: [['list']],
  use: { baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000', viewport: { width: 1600, height: 1000 }, launchOptions: { executablePath: process.env.CHROMIUM_PATH ?? find(), args: ['--no-sandbox'] } },
});
