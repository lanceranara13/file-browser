const UNITS = ["B", "KB", "MB", "GB", "TB"];

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${UNITS[unit]}`;
}

const pad = (value: number) => String(value).padStart(2, "0");

/**
 * `2026-09-15 16:02`. Pass `utc` while server rendering so the markup does not
 * depend on the server's timezone; the client re-renders in local time.
 */
export function formatTimestamp(ms: number, utc = false) {
  const date = new Date(ms);
  const parts = utc
    ? [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes()]
    : [date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getHours(), date.getMinutes()];
  const [year, month, day, hours, minutes] = parts;
  return `${year}-${pad(month)}-${pad(day)} ${pad(hours)}:${pad(minutes)}`;
}
