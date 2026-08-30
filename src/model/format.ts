/* Number and time voices. Pure, and shared by the DOM helpers and the facts
 * builder so a duration reads the same everywhere it appears. */

const UNITS: Array<[number, string]> = [
  [86_400_000, 'D'],
  [3_600_000, 'H'],
  [60_000, 'M'],
];

/** `NOW` / `4M` / `2H` / `1D`, the age voice. */
export function shortAge(ms: number): string {
  if (ms < 60_000) return 'NOW';
  for (const [size, suffix] of UNITS) {
    if (ms >= size) return `${Math.floor(ms / size)}${suffix}`;
  }
  return 'NOW';
}

export function shortDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}MS`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}S`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}M ${seconds}S`;
}

export function compactNumber(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

/** Home-shortened for display. The copied string is always the original. */
export function displayPath(path: string, home: string): string {
  return home && path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}
