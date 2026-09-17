import { createStore, useStore } from 'zustand';
import { applyCommand, type Command } from './commands.js';
import { createFixtureState } from './fixtures.js';
import type { Notification, PlatformState } from './model.js';
import { formatArgs } from '../lib/format.js';

export interface Toast {
  id: string;
  tone: 'success' | 'warning' | 'danger' | 'info';
  title: string;
  body: string;
}

export interface PlatformStore {
  data: PlatformState;
  toasts: Toast[];
  dispatch: (command: Command) => void;
  dismissToast: (id: string) => void;
}

/** Cross-window mirror used while state is local; see `connectWindowSync`. */
export interface CommandMirror {
  publish: (command: Command, at: number) => void;
}

let toastSequence = 0;

/** In-window confirmation for actions the user just took (desktop Toasts come from main). */
function toastFor(command: Command, before: PlatformState): Omit<Toast, 'id'> | undefined {
  const notification = (id: string): Notification | undefined =>
    before.notifications.find((n) => n.id === id);
  const agentName = (n: Notification) => before.agents[n.agentId]?.name ?? n.agentId;
  switch (command.type) {
    case 'interrupt/answer': {
      const n = notification(command.notificationId);
      const payload = n?.interrupt?.payload;
      if (!n || !payload || n.interrupt?.resolution) return undefined;
      if (payload.type === 'tool_approval') {
        const rejected = command.answer.type === 'approval' && command.answer.decision === 'reject';
        return {
          tone: rejected ? 'warning' : 'success',
          title: rejected ? `已拒絕 ${payload.toolName}` : `已批准 ${payload.toolName}，任務繼續`,
          body: `${agentName(n)} · ${formatArgs(payload.args).join(' · ')}`,
        };
      }
      return { tone: 'success', title: '已回覆，任務繼續', body: `${agentName(n)} · ${n.title}` };
    }
    case 'message/send': {
      // The main window's Persona overview does not show the Thread, so confirm where it went.
      const agent = before.agents[command.agentId];
      const thread = before.threads[command.threadId];
      if (!agent || !thread || command.agentId === 'orchestrator') return undefined;
      return {
        tone: 'info',
        title: command.mode === 'async' ? `已派發給 ${agent.name}` : `已送到 ${agent.name}`,
        body: `${thread.title} · ${command.text}`,
      };
    }
    case 'task/cancel': {
      const task = before.tasks[command.taskId];
      return task ? { tone: 'warning', title: '已取消任務', body: task.title } : undefined;
    }
    default:
      return undefined;
  }
}

export function createPlatformStore(initial: PlatformState, now: () => number = Date.now) {
  let mirror: CommandMirror | undefined;
  const store = createStore<PlatformStore>()((set, get) => ({
    data: initial,
    toasts: [],
    dispatch: (command) => {
      const at = now();
      const before = get().data;
      const toast = toastFor(command, before);
      set({ data: applyCommand(before, command, at) });
      if (toast) {
        toastSequence += 1;
        const id = `toast-${toastSequence}`;
        set((s) => ({ toasts: [...s.toasts.slice(-2), { ...toast, id }] }));
      }
      mirror?.publish(command, at);
    },
    dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  }));
  return Object.assign(store, {
    /** Applies a command another window already applied, without echoing it back. */
    applyRemote(command: Command, at: number) {
      store.setState((s) => ({ data: applyCommand(s.data, command, at) }));
    },
    replaceState(data: PlatformState) {
      store.setState({ data });
    },
    setMirror(next: CommandMirror | undefined) {
      mirror = next;
    },
  });
}

export type PlatformStoreApi = ReturnType<typeof createPlatformStore>;

export const platformStore = createPlatformStore(createFixtureState());

export function usePlatform<T>(selector: (store: PlatformStore) => T): T {
  return useStore(platformStore, selector);
}

export function useData(): PlatformState {
  return useStore(platformStore, (s) => s.data);
}

export function useDispatch(): (command: Command) => void {
  return useStore(platformStore, (s) => s.dispatch);
}
