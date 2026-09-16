import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron } from 'playwright';
import { expect, test } from '@playwright/test';

test('launches and renders the scaffold window', async () => {
  // Keep the app's database and browser profile out of the developer's real userData.
  const userData = mkdtempSync(join(tmpdir(), 'arlo-e2e-'));
  const app = await electron.launch({
    args: [join(import.meta.dirname, '../out/main/index.js')],
    env: { ...process.env, ARLO_USER_DATA_DIR: userData },
  });

  try {
    const window = await app.firstWindow();
    await expect(window.getByText('Arlo Harness')).toBeVisible();
    await expect(window.getByText('Electron application scaffold')).toBeVisible();
  } finally {
    await app.close();
    rmSync(userData, { recursive: true, force: true });
  }
});
