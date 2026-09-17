import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils.js';

// Arlo buttons are always pills; no press or scale states (design system: motion is 150ms ease only).
export const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-[5px] whitespace-nowrap rounded-full border border-transparent font-semibold transition-colors duration-150 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground hover:bg-primary-hover',
        outline:
          'border-border-strong bg-background text-muted-foreground hover:border-primary-glow hover:text-foreground',
        reject:
          'border-border-strong bg-background text-muted-foreground hover:border-danger hover:text-danger',
        soft: 'bg-primary-soft text-primary hover:bg-primary-glow',
        danger: 'border-danger bg-background text-danger hover:bg-danger-soft',
        warning: 'bg-warning text-white hover:opacity-90',
        ghost: 'text-faint hover:text-foreground',
        link: 'px-0 text-primary hover:opacity-70',
        dashed: 'border-dashed border-primary-glow bg-background text-primary hover:border-primary',
      },
      size: {
        xs: 'px-[11px] py-[4px] text-tiny',
        sm: 'px-3 py-[5px] text-caption',
        md: 'px-[15px] py-[6px] text-label',
        lg: 'px-5 py-[8px] text-body-sm',
        icon: 'size-[30px] p-0',
        'icon-sm': 'size-[26px] p-0',
      },
    },
    defaultVariants: { variant: 'outline', size: 'sm' },
  },
);

export interface ButtonProps extends ComponentProps<'button'>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : 'button';
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
      {...(asChild ? {} : { type: 'button' as const })}
      {...props}
    />
  );
}
