import type { Command } from './commands.js';
import type { PlatformState } from './model.js';
import type { PlatformStoreApi } from './store.js';

/*
 * Keeps the main window and Persona windows showing the same local state while
 * there is no main-process source of truth yet (T20 replaces this with
 * `state/*` events). A window that opens later asks for a snapshot; commands
 * are then mirrored as they happen.
 */

type SyncMessage =
  | { kind: 'hello'; from: string }
  | { kind: 'snapshot'; from: string; to: string; state: PlatformState }
  | { kind: 'command'; from: string; command: Command; at: number };

export const WINDOW_SYNC_CHANNEL = 'arlo-renderer-state';

export interface SyncPort {
  postMessage: (message: SyncMessage) => void;
  onMessage: (listener: (message: SyncMessage) => void) => void;
  close: () => void;
}

export function broadcastPort(name = WINDOW_SYNC_CHANNEL): SyncPort | undefined {
  if (typeof BroadcastChannel === 'undefined') return undefined;
  try {
    const channel = new BroadcastChannel(name);
    return {
      postMessage: (message) => channel.postMessage(message),
      onMessage: (listener) => {
        channel.onmessage = (event: MessageEvent<SyncMessage>) => listener(event.data);
      },
      close: () => channel.close(),
    };
  } catch {
    return undefined;
  }
}

export function connectWindowSync(store: PlatformStoreApi, port: SyncPort | undefined): () => void {
  if (!port) return () => undefined;
  const self = Math.random().toString(36).slice(2);
  let adopted = false;

  port.onMessage((message) => {
    if (message.from === self) return;
    switch (message.kind) {
      case 'hello':
        port.postMessage({
          kind: 'snapshot',
          from: self,
          to: message.from,
          state: store.getState().data,
        });
        break;
      case 'snapshot':
        if (message.to === self && !adopted) {
          adopted = true;
          store.replaceState(message.state);
        }
        break;
      case 'command':
        store.applyRemote(message.command, message.at);
        break;
    }
  });
  store.setMirror({
    publish: (command, at) => port.postMessage({ kind: 'command', from: self, command, at }),
  });
  port.postMessage({ kind: 'hello', from: self });

  return () => {
    store.setMirror(undefined);
    port.close();
  };
}
