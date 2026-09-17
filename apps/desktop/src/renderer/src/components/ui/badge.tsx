import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils.js';

export const badgeVariants = cva(
  'inline-flex shrink-0 items-center gap-[5px] whitespace-nowrap rounded-full font-semibold',
  {
    variants: {
      tone: {
        primary: 'bg-primary-soft text-primary',
        neutral: 'bg-muted text-muted-foreground',
        success: 'bg-success-soft text-success',
        warning: 'bg-warning-soft text-warning',
        danger: 'bg-danger-soft text-danger',
        'primary-solid': 'bg-primary text-white',
        'warning-solid': 'bg-warning text-white',
        'danger-solid': 'bg-danger text-white',
        'warning-outline': 'border border-warning bg-background text-warning',
      },
      size: {
        xs: 'px-[6px] py-[2px] text-nano',
        sm: 'px-[7px] py-[3px] text-nano font-bold',
        md: 'px-2 py-[3px] text-micro',
        lg: 'px-[9px] py-[3px] text-micro',
      },
    },
    defaultVariants: { tone: 'primary', size: 'md' },
  },
);

export interface BadgeProps extends ComponentProps<'span'>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, size, ...props }: BadgeProps) {
  return (
    <span data-slot="badge" className={cn(badgeVariants({ tone, size }), className)} {...props} />
  );
}
