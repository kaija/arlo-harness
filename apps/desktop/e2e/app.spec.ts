import { join } from 'node:path';
import { _electron as electron } from 'playwright';
import { expect, test } from '@playwright/test';

test('launches and renders the scaffold window', async () => {
  const app = await electron.launch({
    args: [join(import.meta.dirname, '../out/main/index.js')],
  });

  try {
    const window = await app.firstWindow();
    await expect(window.getByText('Arlo Harness')).toBeVisible();
    await expect(window.getByText('Electron application scaffold')).toBeVisible();
  } finally {
    await app.close();
  }
});
