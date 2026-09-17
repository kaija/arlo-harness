import type { RiskLevel } from '@arlo/shared';
import { useEffect, useState, type ComponentProps, type ReactNode } from 'react';
import { cn } from '../../lib/utils.js';
import { Input, Textarea } from './input.js';

/** Text input that keeps a local draft and commits on blur or Enter. */
export function CommitInput({
  value,
  onCommit,
  ...props
}: Omit<ComponentProps<'input'>, 'value' | 'onChange'> & {
  value: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  return (
    <Input
      {...props}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit();
        if (event.key === 'Escape') setDraft(value);
      }}
    />
  );
}

export function CommitTextarea({
  value,
  onCommit,
  ...props
}: Omit<ComponentProps<'textarea'>, 'value' | 'onChange'> & {
  value: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <Textarea
      {...props}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => draft !== value && onCommit(draft)}
    />
  );
}

export function Stepper({
  value,
  min,
  max,
  unit,
  onChange,
  label,
}: {
  value: number;
  min: number;
  max: number;
  unit?: string;
  onChange: (value: number) => void;
  label: string;
}) {
  const step = (delta: number) => onChange(Math.max(min, Math.min(max, value + delta)));
  const button =
    'flex size-[22px] items-center justify-center rounded-full text-body text-muted-foreground hover:bg-muted disabled:text-border-strong';
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex items-center gap-0.5 rounded-full border border-border-strong px-0.5"
    >
      <button
        type="button"
        aria-label={`Decrease ${label}`}
        className={button}
        disabled={value <= min}
        onClick={() => step(-1)}
      >
        −
      </button>
      <span
        className="min-w-[34px] text-center font-mono text-label font-semibold"
        aria-live="polite"
      >
        {value}
        {unit}
      </span>
      <button
        type="button"
        aria-label={`Increase ${label}`}
        className={button}
        disabled={value >= max}
        onClick={() => step(1)}
      >
        +
      </button>
    </div>
  );
}

export function OptionTile({
  selected,
  onSelect,
  title,
  description,
  className,
}: {
  selected: boolean;
  onSelect: () => void;
  title: ReactNode;
  description?: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        'rounded-[11px] border p-3 text-left transition-colors duration-150',
        selected
          ? 'border-primary bg-primary-soft'
          : 'border-border-strong hover:border-primary-glow',
        className,
      )}
    >
      <div className={cn('text-body-sm font-semibold', selected && !description && 'text-primary')}>
        {title}
      </div>
      {description ? (
        <div className="mt-1 text-caption leading-[1.6] text-muted-foreground">{description}</div>
      ) : null}
    </button>
  );
}

const RISK_ON: Readonly<Record<RiskLevel, string>> = {
  low: 'border-success bg-success-soft text-success',
  medium: 'border-warning bg-warning-soft text-warning',
  high: 'border-danger bg-background text-danger',
};

/** low / medium / high chips (ADR-0010). */
export function RiskChips({
  value,
  onChange,
  label,
}: {
  value: RiskLevel | undefined;
  onChange: (risk: RiskLevel) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-1">
      {(['low', 'medium', 'high'] as const).map((risk) => (
        <button
          type="button"
          role="radio"
          key={risk}
          aria-checked={value === risk}
          onClick={() => onChange(risk)}
          className={cn(
            'rounded-full border px-[9px] py-[2px] text-tiny font-semibold transition-colors duration-150',
            value === risk
              ? RISK_ON[risk]
              : 'border-border-strong bg-background text-faint hover:text-foreground',
          )}
        >
          {risk}
        </button>
      ))}
    </div>
  );
}

export function SettingsCard({
  title,
  children,
  className,
}: {
  title?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn('flex flex-col gap-[11px] rounded-md border border-border p-3.5', className)}
    >
      {title ? <div className="text-label font-semibold">{title}</div> : null}
      {children}
    </div>
  );
}

export function SectionHeader({
  title,
  meta,
  children,
}: {
  title: ReactNode;
  meta?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-[9px]">
      <span className="text-body-sm font-semibold">{title}</span>
      {meta ? <span className="text-caption text-faint">{meta}</span> : null}
      <span className="flex-1" />
      {children}
    </div>
  );
}
