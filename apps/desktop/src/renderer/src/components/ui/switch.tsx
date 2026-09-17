import { Switch as SwitchPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils.js';

/** Design system `.switch.switch-sm` on a Radix switch. */
export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'inline-flex h-5 w-[34px] shrink-0 items-center rounded-full border border-border bg-muted p-[2px] transition-colors duration-250 data-[state=checked]:border-primary data-[state=checked]:bg-primary disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block size-[14px] rounded-full bg-white shadow-[0_1px_2px_rgb(0_0_0/0.04),0_0_0_1px_rgb(0_0_0/0.04)] transition-transform duration-250 data-[state=checked]:translate-x-[14px]" />
    </SwitchPrimitive.Root>
  );
}
