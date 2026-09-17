import type { Tone } from '../state/selectors.js';

// Full class names so Tailwind sees them.
export const TONE_TEXT: Readonly<Record<Tone, string>> = {
  accent: 'text-primary',
  warning: 'text-warning',
  danger: 'text-danger',
  success: 'text-success',
  idle: 'text-faint',
};

export const TONE_BG: Readonly<Record<Tone, string>> = {
  accent: 'bg-primary',
  warning: 'bg-warning',
  danger: 'bg-danger',
  success: 'bg-success',
  idle: 'bg-faint',
};

export const TONE_TINT: Readonly<Record<Tone, string>> = {
  accent: 'bg-primary-soft',
  warning: 'bg-warning-tint',
  danger: 'bg-danger-tint',
  success: 'bg-success-soft',
  idle: 'bg-muted',
};

export const TONE_BORDER: Readonly<Record<Tone, string>> = {
  accent: 'border-primary-glow',
  warning: 'border-warning',
  danger: 'border-danger',
  success: 'border-success',
  idle: 'border-border',
};

/** Soft outer ring used on cards that need attention. */
export const TONE_RING: Readonly<Record<Tone, string>> = {
  accent: 'shadow-[0_0_0_3px_var(--color-primary-soft)]',
  warning: 'shadow-[0_0_0_3px_var(--color-warning-soft)]',
  danger: 'shadow-[0_0_0_3px_var(--color-danger-soft)]',
  success: 'shadow-[0_0_0_3px_var(--color-success-soft)]',
  idle: '',
};
