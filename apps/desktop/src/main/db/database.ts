import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.js';

export const DATABASE_FILE_NAME = 'arlo.db';

export type ArloDb = BetterSQLite3Database<typeof schema>;

export interface ArloDatabase {
  db: ArloDb;
  sqlite: Database.Database;
  close(): void;
}

export interface OpenDatabaseOptions {
  /** Folder holding drizzle-kit migrations; bundled next to the main entry at build time. */
  migrationsFolder: string;
}

const MIGRATIONS_TABLE = '__drizzle_migrations';

/**
 * A database file that already has tables but no migration history, e.g.
 * one left by an earlier prototype. Migrating it would fail on the first
 * `CREATE TABLE`, so it is refused before anything is written.
 */
export class UnmanagedDatabaseError extends Error {
  readonly filePath: string;
  readonly tables: string[];

  constructor(filePath: string, tables: string[]) {
    super(
      `${filePath} already has tables (${tables.join(', ')}) but no migration history, so this ` +
        'version of Arlo Harness did not create it. Move or delete the file, then start the app ' +
        'again to create a new database.',
    );
    this.name = 'UnmanagedDatabaseError';
    this.filePath = filePath;
    this.tables = tables;
  }
}

function assertManagedByMigrations(sqlite: Database.Database, filePath: string): void {
  const tables = (
    sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as { name: string }[]
  ).map((row) => row.name);
  const appTables = tables.filter((name) => name !== MIGRATIONS_TABLE);
  if (appTables.length === 0) return;
  const applied = tables.includes(MIGRATIONS_TABLE)
    ? (
        sqlite.prepare(`SELECT count(*) AS count FROM ${MIGRATIONS_TABLE}`).get() as {
          count: number;
        }
      ).count
    : 0;
  if (applied === 0) throw new UnmanagedDatabaseError(filePath, appTables);
}

/**
 * Opens main's single SQLite database (ADR-0011 §1) in WAL mode and applies
 * pending migrations. Only main calls this; Agents reach the data through
 * `db/*` service calls. `:memory:` is accepted for tests.
 */
export function openDatabase(filePath: string, options: OpenDatabaseOptions): ArloDatabase {
  if (filePath !== ':memory:') mkdirSync(dirname(filePath), { recursive: true });
  const sqlite = new Database(filePath);
  try {
    assertManagedByMigrations(sqlite, filePath);
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('synchronous = NORMAL');
    sqlite.pragma('foreign_keys = ON');
    sqlite.pragma('busy_timeout = 5000');
    const db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder: options.migrationsFolder });
    return {
      db,
      sqlite,
      close: () => {
        if (sqlite.open) sqlite.close();
      },
    };
  } catch (error) {
    sqlite.close();
    throw error;
  }
}
