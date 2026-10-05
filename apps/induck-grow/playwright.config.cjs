const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests',
  testMatch: '*.spec.cjs',
  use: { baseURL: 'http://127.0.0.1:4173', browserName: 'chromium' },
  webServer: { command: 'node tests/server.cjs', url: 'http://127.0.0.1:4173', reuseExistingServer: false },
  workers: 1,
  timeout: 30000,
});
