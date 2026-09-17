import { ToggleGroup } from 'radix-ui';
import { cn } from '../../lib/utils.js';

interface SegmentedProps<T extends string> {
  value: T;
  onValueChange: (value: T) => void;
  options: readonly { value: T; label: string }[];
  size?: 'sm' | 'md';
  className?: string;
  'aria-label': string;
}

/** Pill segmented control on a sunken track (design system `.tabs-pill`). */
export function Segmented<T extends string>({
  value,
  onValueChange,
  options,
  size = 'md',
  className,
  ...props
}: SegmentedProps<T>) {
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      onValueChange={(next) => {
        if (next) onValueChange(next as T);
      }}
      className={cn(
        'flex gap-[3px] rounded-full bg-muted p-[3px]',
        size === 'sm' && 'gap-[2px] p-[2px]',
        className,
      )}
      aria-label={props['aria-label']}
    >
      {options.map((option) => (
        <ToggleGroup.Item
          key={option.value}
          value={option.value}
          className={cn(
            'rounded-full font-semibold text-muted-foreground transition-colors duration-150 data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm',
            size === 'md' ? 'px-[13px] py-[4px] text-label' : 'px-[10px] py-[3px] text-tiny',
          )}
        >
          {option.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}

interface ChipGroupProps<T extends string> {
  value: T;
  onValueChange: (value: T) => void;
  options: readonly { value: T; label: string }[];
  className?: string;
  'aria-label': string;
}

/** Filter chips: filled accent when on, hairline pill when off. */
export function ChipGroup<T extends string>({
  value,
  onValueChange,
  options,
  className,
  ...props
}: ChipGroupProps<T>) {
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      onValueChange={(next) => {
        if (next) onValueChange(next as T);
      }}
      className={cn('flex flex-wrap gap-1', className)}
      aria-label={props['aria-label']}
    >
      {options.map((option) => (
        <ToggleGroup.Item
          key={option.value}
          value={option.value}
          className="rounded-full border border-border-strong bg-background px-[9px] py-[2px] text-tiny font-semibold text-muted-foreground transition-all duration-150 hover:opacity-75 data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-white data-[state=on]:hover:opacity-100"
        >
          {option.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
