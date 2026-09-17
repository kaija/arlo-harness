import type { ReactNode } from 'react';
import { platform } from '../lib/bridge.js';
import { cn } from '../lib/utils.js';

/**
 * The window's own title bar. On macOS the window uses `hiddenInset`, so the
 * traffic lights sit inside this bar and it drags the window.
 */
export function WindowTitleBar({
  title,
  children,
  className,
}: {
  title: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const mac = platform() === 'darwin';
  return (
    <header
      className={cn(
        'drag-region flex h-8 shrink-0 items-center gap-2 border-b border-border bg-secondary pr-3',
        mac ? 'pl-[78px]' : 'pl-3',
        className,
      )}
    >
      <span className="truncate text-body-sm font-semibold text-muted-foreground">{title}</span>
      <span className="flex-1" />
      <div className="no-drag flex items-center gap-2">{children}</div>
    </header>
  );
}
