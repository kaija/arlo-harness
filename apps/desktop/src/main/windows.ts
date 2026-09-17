import { join } from 'node:path';
import {
  rendererInvokeContract,
  validateCall,
  type ContractParams,
  type RendererInvokeChannel,
} from '@arlo/shared';
import { app, BrowserWindow, ipcMain, type BrowserWindowConstructorOptions } from 'electron';

type Contract = typeof rendererInvokeContract;

const isMac = process.platform === 'darwin';

function baseOptions(): BrowserWindowConstructorOptions {
  return {
    show: false,
    backgroundColor: '#ffffff',
    // macOS: traffic lights sit inside the renderer's 32px title bar.
    ...(isMac
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 12, y: 10 } }
      : {}),
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  };
}

/** Loads a renderer route. A fragment-only change on a loaded window navigates in place, without a reload. */
function loadRoute(window: BrowserWindow, route: string): Promise<void> {
  if (process.env.ELECTRON_RENDERER_URL) {
    return window.loadURL(`${process.env.ELECTRON_RENDERER_URL}#${route}`);
  }
  return window.loadFile(join(import.meta.dirname, '../renderer/index.html'), { hash: route });
}

function reveal(window: BrowserWindow): void {
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

/**
 * ADR-0007: one main window plus one window per Persona, created on first use.
 * Closing a Persona window hides it; the Persona keeps running.
 */
export class WindowManager {
  private main: BrowserWindow | undefined;
  private readonly personaWindows = new Map<string, BrowserWindow>();
  private quitting = false;

  constructor() {
    app.on('before-quit', () => {
      this.quitting = true;
    });
  }

  get mainWindow(): BrowserWindow | undefined {
    return this.main;
  }

  async showMain(route = '/main'): Promise<void> {
    if (this.main && !this.main.isDestroyed()) {
      if (route !== '/main') await loadRoute(this.main, route);
      reveal(this.main);
      return;
    }
    const window = new BrowserWindow({
      ...baseOptions(),
      width: 1280,
      height: 800,
      minWidth: 520,
      minHeight: 560,
      title: 'Arlo Harness',
    });
    this.main = window;
    window.on('close', (event) => {
      // macOS keeps the app (and hidden Persona windows) alive; elsewhere the main window owns the app.
      if (this.quitting) return;
      if (isMac) {
        event.preventDefault();
        window.hide();
      } else {
        app.quit();
      }
    });
    window.on('closed', () => {
      if (this.main === window) this.main = undefined;
    });
    window.once('ready-to-show', () => window.show());
    await loadRoute(window, route);
  }

  async showPersona(personaId: string, contextId?: string): Promise<void> {
    const route = `/persona/${personaId}${contextId ? `?thread=${encodeURIComponent(contextId)}` : ''}`;
    const existing = this.personaWindows.get(personaId);
    if (existing && !existing.isDestroyed()) {
      if (contextId) await loadRoute(existing, route);
      reveal(existing);
      return;
    }
    const window = new BrowserWindow({
      ...baseOptions(),
      width: 1320,
      height: 840,
      minWidth: 460,
      minHeight: 560,
      title: 'Persona',
    });
    this.personaWindows.set(personaId, window);
    window.on('close', (event) => {
      if (this.quitting) return;
      event.preventDefault();
      window.hide();
    });
    window.on('closed', () => this.personaWindows.delete(personaId));
    window.once('ready-to-show', () => reveal(window));
    await loadRoute(window, route);
  }

  /** Registers the window channels of `rendererInvokeContract`; params are validated before use. */
  registerIpc(): void {
    this.handle('windows/showPersona', (params) =>
      this.showPersona(params.personaId, params.contextId),
    );
    this.handle('windows/showMain', (params) =>
      this.showMain(
        params.taskId ? `/main?panel=tree&task=${encodeURIComponent(params.taskId)}` : '/main',
      ),
    );
  }

  private ownsSender(sender: Electron.WebContents): boolean {
    const window = BrowserWindow.fromWebContents(sender);
    return (
      window !== null &&
      (window === this.main || [...this.personaWindows.values()].includes(window))
    );
  }

  private handle<C extends RendererInvokeChannel>(
    channel: C,
    run: (params: ContractParams<Contract, C>) => Promise<void>,
  ): void {
    ipcMain.handle(channel, async (event, params: unknown) => {
      if (!this.ownsSender(event.sender))
        throw new Error(`${channel}: sender is not an Arlo window.`);
      const call = validateCall(rendererInvokeContract, channel, params);
      if (!call.ok) throw new Error(call.error.message);
      await run(call.params as ContractParams<Contract, C>);
      return null;
    });
  }
}
