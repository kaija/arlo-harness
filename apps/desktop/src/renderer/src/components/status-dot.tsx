import { cn } from '../lib/utils.js';
import type { Tone } from '../state/selectors.js';
import { TONE_BG } from './tone.js';

export function StatusDot({
  tone,
  pulse = false,
  size = 6,
  className,
}: {
  tone: Tone;
  pulse?: boolean;
  size?: 5 | 6 | 7;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'shrink-0 rounded-full',
        size === 5 ? 'size-[5px]' : size === 6 ? 'size-[6px]' : 'size-[7px]',
        TONE_BG[tone],
        pulse && 'animate-pulse-dot',
        className,
      )}
    />
  );
}
