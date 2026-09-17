import { cn } from '../../lib/utils.js';

export function Progress({
  value,
  className,
  barClassName,
}: {
  /** 0–100. */
  value: number;
  className?: string;
  barClassName?: string;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn('h-1 overflow-hidden rounded-full bg-muted', className)}
    >
      <span
        className={cn(
          'block h-full rounded-full bg-primary transition-[width] duration-400',
          barClassName,
        )}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
