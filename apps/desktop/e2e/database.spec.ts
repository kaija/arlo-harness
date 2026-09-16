import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { _electron as electron } from 'playwright';
import { expect, test } from '@playwright/test';

const mainEntry = join(import.meta.dirname, '../out/main/index.js');

async function runApp(userData: string): Promise<string> {
  const app = await electron.launch({
    args: [mainEntry],
    env: { ...process.env, ARLO_USER_DATA_DIR: userData },
  });
  try {
    await app.firstWindow();
    return await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'));
  } finally {
    await app.close();
  }
}

test('main opens arlo.db in userData with WAL and keeps rows across restarts', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'arlo-e2e-db-'));
  const dbPath = join(userData, 'arlo.db');
  try {
    expect(await runApp(userData)).toBe(userData);

    let sqlite = new Database(dbPath);
    try {
      expect(sqlite.pragma('journal_mode', { simple: true })).toBe('wal');
      const tables = sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all()
        .map((row) => (row as { name: string }).name);
      expect(tables).toEqual(
        expect.arrayContaining([
          'a2a_tasks',
          'delegations',
          'messages',
          'notifications',
          'run_states',
          'threads',
        ]),
      );
      sqlite
        .prepare(
          'INSERT INTO messages (agent_id, context_id, seq, item_json, created_at) VALUES (?, ?, ?, ?, ?)',
        )
        .run('persona:research-analyst', 'user:research-analyst', 1, '{"role":"user"}', Date.now());
    } finally {
      sqlite.close();
    }

    await runApp(userData);

    sqlite = new Database(dbPath, { readonly: true });
    try {
      expect(sqlite.prepare('SELECT count(*) AS count FROM messages').get()).toEqual({ count: 1 });
      expect(sqlite.prepare('SELECT count(*) AS count FROM __drizzle_migrations').get()).toEqual({
        count: 1,
      });
    } finally {
      sqlite.close();
    }
  } finally {
    rmSync(userData, { recursive: true, force: true });
  }
});
