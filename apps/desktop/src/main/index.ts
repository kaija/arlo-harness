import { join } from 'node:path';
import { app, BrowserWindow, dialog } from 'electron';
import { DATABASE_FILE_NAME, openDatabase, type ArloDatabase } from './db/index.js';

let mainWindow: BrowserWindow | undefined;
let database: ArloDatabase | undefined;

// Lets tests and parallel dev profiles use a throwaway data folder.
if (process.env.ARLO_USER_DATA_DIR) {
  app.setPath('userData', process.env.ARLO_USER_DATA_DIR);
}

async function createMainWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 800,
    minHeight: 560,
    title: 'Arlo Harness',
    backgroundColor: '#0b1118',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    await mainWindow.loadFile(join(import.meta.dirname, '../renderer/index.html'));
  }
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
  await createMainWindow();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) void createMainWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  database?.close();
  database = undefined;
});
