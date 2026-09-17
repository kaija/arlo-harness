import { describe, expect, it } from 'vitest';
import {
  formatAgo,
  formatArgs,
  formatClock,
  formatCountdown,
  formatDurationCompact,
  formatElapsed,
  formatElapsedShort,
  formatLocalDate,
  formatMs,
  formatSeconds,
  formatThreadStamp,
  renderTemplate,
} from '../src/renderer/src/lib/format.js';

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
// Wednesday 2026-09-16 10:00 local time.
const NOW = new Date(2026, 8, 16, 10, 0, 0).getTime();

describe('durations', () => {
  it('formats elapsed time for status lines and timers', () => {
    expect(formatElapsedShort(-5)).toBe('0s');
    expect(formatElapsedShort(40 * SECOND)).toBe('40s');
    expect(formatElapsedShort(14 * MINUTE + 22 * SECOND)).toBe('14m');
    expect(formatElapsedShort(2 * HOUR)).toBe('2h');
    expect(formatElapsedShort(HOUR + 47 * MINUTE)).toBe('1h 47m');
    expect(formatElapsed(9 * SECOND)).toBe('9s');
    expect(formatElapsed(2 * MINUTE + 5 * SECOND)).toBe('2m 05s');
    expect(formatElapsed(HOUR + 47 * MINUTE)).toBe('1h 47m');
    expect(formatCountdown(8_000)).toBe('0:08');
    expect(formatCountdown(7_001)).toBe('0:08');
    expect(formatCountdown(-1)).toBe('0:00');
    expect(formatCountdown(95_000)).toBe('1:35');
  });

  it('formats trace numbers', () => {
    expect(formatMs(24180)).toBe('24,180');
    expect(formatSeconds(18_400)).toBe('18.4s');
    expect(formatDurationCompact(120)).toBe('120ms');
    expect(formatDurationCompact(4_200)).toBe('4.2s');
    expect(formatDurationCompact(3 * MINUTE)).toBe('3m 00s');
  });
});

describe('wall-clock stamps', () => {
  const at = (days: number, h: number, m: number) => {
    const date = new Date(NOW + days * DAY);
    date.setHours(h, m, 0, 0);
    return date.getTime();
  };

  it('formats past and future times relative to today', () => {
    expect(formatClock(at(0, 9, 41), NOW)).toBe('09:41');
    expect(formatClock(at(-1, 22, 0), NOW)).toBe('昨天 22:00');
    expect(formatClock(at(-3, 8, 0), NOW)).toBe('3d');
    expect(formatClock(at(1, 8, 30), NOW)).toBe('明天 08:30');
    expect(formatClock(at(5, 9, 0), NOW)).toBe('週一 09:00');
    expect(formatClock(at(20, 9, 0), NOW)).toBe('10/6 09:00');
  });

  it('formats "ago" and thread list stamps', () => {
    expect(formatAgo(NOW - 20 * SECOND, NOW)).toBe('now');
    expect(formatAgo(NOW - 6 * MINUTE, NOW)).toBe('6m ago');
    expect(formatAgo(at(0, 8, 0), NOW)).toBe('08:00');
    expect(formatThreadStamp(NOW - 10 * SECOND, NOW)).toBe('now');
    expect(formatThreadStamp(NOW - 14 * MINUTE, NOW)).toBe('14m');
    expect(formatThreadStamp(at(0, 8, 30), NOW)).toBe('08:30');
    expect(formatThreadStamp(at(-1, 13, 0), NOW)).toBe('昨天');
    expect(formatThreadStamp(NOW - 3 * DAY, NOW)).toBe('3d');
  });
});

describe('templates and arguments', () => {
  it('renders known variables and reports unknown ones', () => {
    const when = at();
    function at() {
      return new Date(2026, 8, 15, 8, 30, 0).getTime();
    }
    const { text, unknown } = renderTemplate(
      '{{ date }} {{current_time}} {{timestamp}} {{symbol}}',
      when,
    );
    expect(formatLocalDate(when)).toBe('2026-09-15');
    expect(text).toMatch(/^2026-09-15 2026-09-15 08:30 \([+-]\d{2}:\d{2}\) \d+ \{\{symbol\}\}$/);
    expect(unknown).toEqual(['symbol']);
  });

  it('prints tool arguments as key: value lines', () => {
    expect(formatArgs({ campaign: '秋季新品_搜尋', budget: { to: 2400 } })).toEqual([
      'campaign: 秋季新品_搜尋',
      'budget: {"to":2400}',
    ]);
    expect(formatArgs([1, 2])).toEqual(['[1,2]']);
    expect(formatArgs(null)).toEqual(['null']);
  });
});
