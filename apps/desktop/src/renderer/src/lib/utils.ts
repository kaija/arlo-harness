import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// Teach tailwind-merge the theme's custom scales (styles.css @theme). Without this,
// `text-tiny` looks like a color and is dropped when followed by `text-faint`.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ['nano', 'micro', 'tiny', 'caption', 'label', 'body-sm', 'body', 'title'],
      radius: ['xs', 'mark', 'sm', 'tile', 'md', 'bubble', 'lg', 'xl'],
    },
  },
});

/** shadcn/ui class combiner: later Tailwind utilities win over earlier ones. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
