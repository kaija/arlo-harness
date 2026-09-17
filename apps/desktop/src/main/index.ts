import { join } from 'node:path';
import { app, dialog } from 'electron';
import { DATABASE_FILE_NAME, openDatabase, type ArloDatabase } from './db/index.js';
import { WindowManager } from './windows.js';

let database: ArloDatabase | undefined;
let windows: WindowManager | undefined;

// Lets tests and parallel dev profiles use a throwaway data folder.
if (process.env.ARLO_USER_DATA_DIR) {
  app.setPath('userData', process.env.ARLO_USER_DATA_DIR);
}

function openAppDatabase(): boolean {
  try {
    // ADR-0011 §1: one database owned by main at <userData>/arlo.db.
    database = openDatabase(join(app.getPath('userData'), DATABASE_FILE_NAME), {
      migrationsFolder: join(import.meta.dirname, 'migrations'),
    });
    return true;
  } catch (error) {
    dialog.showErrorBox(
      'Arlo Harness could not open its database',
      error instanceof Error ? error.message : String(error),
    );
    return false;
  }
}

void app.whenReady().then(async () => {
  if (!openAppDatabase()) {
    app.exit(1);
    return;
  }
  windows = new WindowManager();
  windows.registerIpc();
  await windows.showMain();
});

app.on('activate', () => {
  void windows?.showMain();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  database?.close();
  database = undefined;
});
