/**
 * Formats UTC RFC3339 strings consistently.
 * Handles null and Go zero UTC timestamps ("0001-01-01T00:00:00Z") per docs/api.md:
 * "没有缓存时健康状态中的时间为零值 UTC 日期；Validation 中对应时间使用 null。"
 */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '暂无记录 (null)';
  if (iso.startsWith('0001-01-01')) return '尚无缓存 (零值时间)';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

export function shortHex(hex: string | null | undefined, head = 8, tail = 8): string {
  if (!hex) return '—';
  if (hex.length <= head + tail + 3) return hex;
  return `${hex.slice(0, head)}…${hex.slice(-tail)}`;
}
