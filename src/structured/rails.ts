/* The one-red-region law, as geometry.
 *
 * Every contiguous run of unowned rows carries a rail, a run of one included:
 * a rail-less red dot beside an amber dot would be a hue-only distinction, and
 * shape has to carry the semantics. Rank is carried by rail WEIGHT rather than
 * by a quieter hue - the first run in a reply is heavier, every run stays at
 * full strength - because a quieter hue buys rank with contrast the rail cannot
 * afford, while a thinner rail buys the same rank for free. */

import type { Disposition } from './model';

/** Inclusive [start, end] index pairs of each contiguous unowned run. */
export function railRuns(rows: Array<{ disposition: Disposition | null }>): Array<[number, number]> {
  const runs: Array<[number, number]> = [];
  let start = -1;
  rows.forEach((row, i) => {
    if (row.disposition === 'unowned') {
      if (start === -1) start = i;
    } else if (start !== -1) {
      runs.push([start, i - 1]);
      start = -1;
    }
  });
  if (start !== -1) runs.push([start, rows.length - 1]);
  return runs;
}
