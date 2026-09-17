import { useEffect } from 'react';
import { Icon } from '../../components/icon.js';
import { cn } from '../../lib/utils.js';
import { usePlatform, type Toast } from '../../state/store.js';

const TOAST_MS = 6_000;

function ToastCard({ toast }: { toast: Toast }) {
  const dismiss = usePlatform((s) => s.dismissToast);
  const onDismiss = () => dismiss(toast.id);
  // Keyed on the id only: parents re-render every clock tick and must not restart the timer.
  useEffect(() => {
    const timer = setTimeout(() => dismiss(toast.id), TOAST_MS);
    return () => clearTimeout(timer);
  }, [dismiss, toast.id]);
  return (
    <div
      role="status"
      className={cn(
        'animate-reveal rounded-md border bg-white/92 px-3 py-[11px] shadow-xl backdrop-blur-[20px] backdrop-saturate-[1.8]',
        toast.tone === 'danger' ? 'border-danger' : 'border-border-strong',
      )}
    >
      <div className="flex items-center gap-[7px]">
        <span
          className={cn(
            toast.tone === 'success' && 'text-success',
            toast.tone === 'warning' && 'text-warning',
            toast.tone === 'danger' && 'text-danger',
            toast.tone === 'info' && 'text-primary',
          )}
        >
          <Icon
            name={
              toast.tone === 'success' ? 'check' : toast.tone === 'info' ? 'info' : 'alert-triangle'
            }
            size={14}
          />
        </span>
        <span className="min-w-0 flex-1 truncate text-label font-semibold">{toast.title}</span>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onDismiss}
          className="text-faint hover:text-foreground"
        >
          <Icon name="close" size={13} />
        </button>
      </div>
      <div className="mt-[5px] text-caption leading-[1.55] text-muted-foreground">{toast.body}</div>
    </div>
  );
}

/** In-window confirmation of the user's own actions; system Toasts are posted by main (ADR-0012). */
export function ToastStack() {
  const toasts = usePlatform((s) => s.toasts);
  return (
    <div className="pointer-events-none absolute top-3 right-4 z-40 flex w-[300px] flex-col gap-2">
      {toasts.map((toast) => (
        <div key={toast.id} className="pointer-events-auto">
          <ToastCard toast={toast} />
        </div>
      ))}
    </div>
  );
}
