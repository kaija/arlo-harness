import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, type ElectronApplication } from 'playwright';
import { expect, test } from '@playwright/test';

const mainEntry = join(import.meta.dirname, '../out/main/index.js');

async function launch(): Promise<{ app: ElectronApplication; cleanup: () => Promise<void> }> {
  // Keep the app's database and browser profile out of the developer's real userData.
  const userData = mkdtempSync(join(tmpdir(), 'arlo-e2e-'));
  const app = await electron.launch({
    args: [mainEntry],
    env: { ...process.env, ARLO_USER_DATA_DIR: userData },
  });
  return {
    app,
    cleanup: async () => {
      await app.close();
      rmSync(userData, { recursive: true, force: true });
    },
  };
}

test('launches the main window with agents, chat and action center', async () => {
  const { app, cleanup } = await launch();
  try {
    const window = await app.firstWindow();
    await expect(window).toHaveTitle('Arlo Harness');
    await expect(window.getByRole('navigation', { name: 'Agents' })).toBeVisible();
    await expect(window.getByRole('complementary', { name: 'Action center' })).toBeVisible();
    await expect(window.getByText('Pinned · needs you')).toBeVisible();
  } finally {
    await cleanup();
  }
});

test('opens a Persona window, hides it on close, and mirrors answers across windows', async () => {
  const { app, cleanup } = await launch();
  try {
    const main = await app.firstWindow();
    await main.getByRole('button', { name: /^Google Ads 投放員, / }).click();
    const [persona] = await Promise.all([
      app.waitForEvent('window'),
      main.getByRole('button', { name: 'Open window', exact: true }).first().click(),
    ]);
    await expect(persona).toHaveTitle('Google Ads 投放員 — Persona');
    expect(persona.url()).toContain('#/persona/google-ads');

    // Approving in the main window resolves the same request in the Persona window.
    await expect(persona.getByText('Tool approval · 需要你批准')).toBeVisible();
    await main
      .getByRole('complementary', { name: 'Action center' })
      .getByRole('button', { name: 'Allow', exact: true })
      .click();
    await expect(persona.getByText('Approved · update_campaign_budget')).toBeVisible();

    // ADR-0007 §3: closing a Persona window hides it; opening again reuses it.
    const hidden = await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find((w) =>
        w.webContents.getURL().includes('/persona/'),
      );
      window?.close();
      return window ? { destroyed: window.isDestroyed(), visible: window.isVisible() } : undefined;
    });
    expect(hidden).toEqual({ destroyed: false, visible: false });
    await main.getByRole('button', { name: 'Open window', exact: true }).first().click();
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()
            .filter((w) => w.webContents.getURL().includes('/persona/'))
            .map((w) => w.isVisible()),
        ),
      )
      .toEqual([true]);
  } finally {
    await cleanup();
  }
});

test('a delegated Thread links back to its Orchestrator task without reloading the main window', async () => {
  const { app, cleanup } = await launch();
  try {
    const main = await app.firstWindow();
    await main.evaluate(() => {
      (window as unknown as { __marker: number }).__marker = 1;
    });
    const [persona] = await Promise.all([
      app.waitForEvent('window'),
      main.getByRole('button', { name: /Open 股票研究員 thread/ }).click(),
    ]);
    await expect(persona.getByRole('button', { name: /台積電 Q3 財報摘要/ })).toHaveAttribute(
      'aria-current',
      'true',
    );
    await persona.getByRole('button', { name: '回到來源任務 ↑' }).click();
    await expect(main.getByRole('radio', { name: 'Task tree' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(main.url()).toContain('task=task-weekly');
    expect(await main.evaluate(() => (window as unknown as { __marker?: number }).__marker)).toBe(
      1,
    );
  } finally {
    await cleanup();
  }
});

test('rejects window IPC with invalid params', async () => {
  const { app, cleanup } = await launch();
  try {
    const main = await app.firstWindow();
    const error = await main.evaluate(async () => {
      const bridge = (
        window as unknown as {
          arlo: { windows: { showPersona: (p: unknown) => Promise<unknown> } };
        }
      ).arlo;
      try {
        await bridge.windows.showPersona({ personaId: '../../etc' });
        return 'accepted';
      } catch (err) {
        return String(err);
      }
    });
    expect(error).toContain('Invalid params');
  } finally {
    await cleanup();
  }
});
