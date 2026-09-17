import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../../lib/utils.js';

interface FieldProps extends Omit<ComponentProps<'label'>, 'children'> {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
}

/** Design system `.field`: label, control, optional hint, stacked. */
export function Field({ label, hint, className, children, ...props }: FieldProps) {
  return (
    <label className={cn('flex flex-col gap-[6px]', className)} {...props}>
      <span className="text-label font-semibold tracking-[-0.01em]">{label}</span>
      {children}
      {hint ? <span className="text-tiny leading-[1.5] text-faint">{hint}</span> : null}
    </label>
  );
}
