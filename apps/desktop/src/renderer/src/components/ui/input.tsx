import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils.js';
import { Icon, type IconName } from '../icon.js';

// Design system `.input.input-sm`: 8px radius, strong hairline, accent focus ring.
const fieldClass =
  'w-full rounded-sm border border-border-strong bg-background px-[11px] py-[6px] text-body-sm text-foreground transition-[border-color,box-shadow] duration-150 placeholder:text-faint hover:border-black/20 focus:border-primary focus:shadow-[0_0_0_3px_var(--color-primary-soft)] focus:outline-none disabled:cursor-not-allowed disabled:bg-secondary disabled:text-faint aria-invalid:border-danger';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input data-slot="input" className={cn(fieldClass, className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(fieldClass, 'min-h-[62px] resize-y leading-[1.6]', className)}
      {...props}
    />
  );
}

export function SearchInput({
  className,
  icon = 'search',
  ...props
}: ComponentProps<'input'> & { icon?: IconName }) {
  return (
    <div className="group relative flex items-center">
      <span className="pointer-events-none absolute left-[11px] text-faint group-focus-within:text-primary">
        <Icon name={icon} size={14} />
      </span>
      <Input className={cn('pl-[32px]', className)} {...props} />
    </div>
  );
}

export function NativeSelect({ className, children, ...props }: ComponentProps<'select'>) {
  return (
    <div className="relative flex w-full items-center">
      <select
        data-slot="select"
        className={cn(fieldClass, 'cursor-pointer appearance-none pr-8', className)}
        {...props}
      >
        {children}
      </select>
      <span className="pointer-events-none absolute right-[11px] text-faint">
        <Icon name="chevron-down" size={13} />
      </span>
    </div>
  );
}
