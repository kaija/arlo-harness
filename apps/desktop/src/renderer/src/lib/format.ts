const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** "14m", "1h 47m", "40s" — for status lines. */
export function formatElapsedShort(ms: number): string {
  const safe = Math.max(0, ms);
  if (safe < MINUTE) return `${Math.floor(safe / SECOND)}s`;
  if (safe < HOUR) return `${Math.floor(safe / MINUTE)}m`;
  const hours = Math.floor(safe / HOUR);
  const minutes = Math.floor((safe % HOUR) / MINUTE);
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

/** "14m 22s", "2m 10s", "1h 47m" — for running timers. */
export function formatElapsed(ms: number): string {
  const safe = Math.max(0, ms);
  if (safe < MINUTE) return `${Math.floor(safe / SECOND)}s`;
  if (safe < HOUR) {
    return `${Math.floor(safe / MINUTE)}m ${pad(Math.floor((safe % MINUTE) / SECOND))}s`;
  }
  return formatElapsedShort(safe);
}

/** "0:08" — restart countdowns. */
export function formatCountdown(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / SECOND));
  return `${Math.floor(seconds / 60)}:${pad(seconds % 60)}`;
}

/** "3,180" / "18.4s" for trace spans. */
export function formatMs(ms: number): string {
  return ms.toLocaleString('en-US');
}

export function formatSeconds(ms: number): string {
  return `${(ms / SECOND).toFixed(1)}s`;
}

export function formatDurationCompact(ms: number): string {
  if (ms < SECOND) return `${Math.round(ms)}ms`;
  if (ms < MINUTE) return `${(ms / SECOND).toFixed(1)}s`;
  return formatElapsed(ms);
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

const WEEKDAYS = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'] as const;

/** "09:41", "昨天 22:00", "3d" — wall-clock stamps in lists; "明天 08:30", "週一 09:00" ahead. */
export function formatClock(at: number, now: number): string {
  const date = new Date(at);
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const today = new Date(now);
  if (sameDay(date, today)) return time;
  if (at > now) {
    if (sameDay(date, new Date(now + DAY))) return `明天 ${time}`;
    if (at - now < 7 * DAY) return `${WEEKDAYS[date.getDay()]} ${time}`;
    return `${date.getMonth() + 1}/${date.getDate()} ${time}`;
  }
  if (sameDay(date, new Date(now - DAY))) return `昨天 ${time}`;
  return `${Math.max(1, Math.round((now - at) / DAY))}d`;
}

/** "now", "2m ago", "6m ago", "昨天 22:06". */
export function formatAgo(at: number, now: number): string {
  const diff = now - at;
  if (diff < MINUTE) return 'now';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m ago`;
  return formatClock(at, now);
}

/** Thread list stamps: "now", "14m", "08:30", "昨天", "3d". */
export function formatThreadStamp(at: number, now: number): string {
  const diff = now - at;
  if (diff < MINUTE) return 'now';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m`;
  const date = new Date(at);
  if (sameDay(date, new Date(now))) return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (sameDay(date, new Date(now - DAY))) return '昨天';
  return `${Math.max(1, Math.round(diff / DAY))}d`;
}

/** "2026-09-15 08:30 (+08:00)" — template preview for {{current_time}}. */
export function formatLocalTimestamp(at: number): string {
  const date = new Date(at);
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  return `${formatLocalDate(at)} ${pad(date.getHours())}:${pad(date.getMinutes())} (${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)})`;
}

export function formatLocalDate(at: number): string {
  const date = new Date(at);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Renders `{{current_time}}`, `{{date}}`, `{{timestamp}}`; unknown variables stay visible. */
export function renderTemplate(template: string, at: number): { text: string; unknown: string[] } {
  const unknown: string[] = [];
  const text = template.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (match, name: string) => {
    switch (name) {
      case 'current_time':
        return formatLocalTimestamp(at);
      case 'date':
        return formatLocalDate(at);
      case 'timestamp':
        return String(Math.floor(at / SECOND));
      default:
        unknown.push(name);
        return match;
    }
  });
  return { text, unknown };
}

/** Tool-call arguments as `key: value` lines. */
export function formatArgs(args: unknown): string[] {
  if (args === null || typeof args !== 'object' || Array.isArray(args))
    return [JSON.stringify(args)];
  return Object.entries(args as Record<string, unknown>).map(
    ([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`,
  );
}
