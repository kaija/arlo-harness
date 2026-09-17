import type { SVGProps } from 'react';
import { iconMarkup, type IconName } from './icon-paths.js';

export type { IconName };

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name' | 'dangerouslySetInnerHTML'> {
  name: IconName;
  /** 24 default · 20 in small buttons · 16 inline with text. */
  size?: number;
  strokeWidth?: number;
}

export function Icon({ name, size = 24, strokeWidth = 2, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={rest['aria-label'] ? undefined : true}
      {...rest}
      style={{ display: 'block', flex: 'none', ...rest.style }}
      // Static markup from the design-system glyph table, never user input.
      dangerouslySetInnerHTML={{ __html: iconMarkup(name) }}
    />
  );
}
