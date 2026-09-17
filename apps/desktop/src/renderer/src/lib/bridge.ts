import type { ArloBridge } from '../../../preload/api.js';

declare global {
  interface Window {
    /** Set by the preload; absent when the renderer runs in a plain browser (vite preview). */
    arlo?: ArloBridge;
  }
}

export function platform(): string {
  return window.arlo?.platform ?? 'browser';
}

/** ADR-0007 §3: open or focus the Persona's own window, optionally on one Thread. */
export function showPersonaWindow(personaId: string, contextId?: string): void {
  if (window.arlo) {
    void window.arlo.windows.showPersona(contextId ? { personaId, contextId } : { personaId });
  } else {
    const query = contextId ? `?thread=${encodeURIComponent(contextId)}` : '';
    window.open(`#/persona/${personaId}${query}`, `persona-${personaId}`);
  }
}

/** Bring the main window forward, optionally on the task that started a delegated Thread. */
export function showMainWindow(taskId?: string): void {
  if (window.arlo) {
    void window.arlo.windows.showMain(taskId ? { taskId } : {});
  } else {
    window.open(
      `#/main${taskId ? `?panel=tree&task=${encodeURIComponent(taskId)}` : ''}`,
      'arlo-main',
    );
  }
}
