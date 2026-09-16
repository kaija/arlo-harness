import type { MessagePort as NodeMessagePort } from 'node:worker_threads';

/**
 * The part of a MessagePort the transport needs. Tests use Node
 * `worker_threads` ports; the desktop app adapts Electron's `MessagePortMain`
 * and the utilityProcess parent port to the same shape, so this package never
 * imports `electron` (ADR-0001).
 */
export interface PortEndpoint {
  postMessage(message: unknown): void;
  /** Starts delivery. Returns a function that removes the listener. */
  onMessage(listener: (message: unknown) => void): () => void;
  /** Fires when either side closes the channel or its process exits. */
  onClose(listener: () => void): () => void;
  close(): void;
}

export function nodeMessagePortEndpoint(port: NodeMessagePort): PortEndpoint {
  return {
    postMessage: (message) => port.postMessage(message),
    onMessage(listener) {
      port.on('message', listener);
      return () => port.off('message', listener);
    },
    onClose(listener) {
      port.on('close', listener);
      return () => port.off('close', listener);
    },
    close: () => port.close(),
  };
}
