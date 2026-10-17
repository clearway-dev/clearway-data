/**
 * What the app stores for one side (distance_left / distance_right) depending on the unit state.
 *
 * The backend and its pipeline need a number on both sides (cleaned_width = left + right + vehicle
 * width) and the database schema must not change, so there is no "unknown" value to store.
 *
 *   ok        the shortest valid distance                       -> stored
 *   tooClose  obstacle inside the dead zone (< 20 cm, TF-Luna)   -> stored as TOO_CLOSE_STORED_CM
 *   noTarget  nothing in range / weak reflection                 -> sample skipped
 *   fault     sensor silent for > 100 ms                         -> sample skipped
 *
 * tooClose is stored on purpose: the firmware already gives it priority over valid values because a
 * false alarm beats a missed obstacle (ClearWay-FW CLAUDE.md, user decision). Storing 0 cm keeps that
 * narrow spot in the data as the worst case instead of dropping exactly the most important sample.
 */
import type { SensorState } from './protocol';

/** Distance stored for a side whose unit reports "too close". 0 = worst case (no clearance). */
export const TOO_CLOSE_STORED_CM = 0;

export const STATE_LABEL: Record<SensorState, string> = {
  ok: 'OK',
  tooClose: 'příliš blízko',
  noTarget: 'nic v dosahu',
  fault: 'porucha',
};

/** Number to store for one side, or null when the sample has to be skipped. */
export function storedDistance(state: SensorState, min: number | null): number | null {
  if (state === 'ok') return min;
  if (state === 'tooClose') return TOO_CLOSE_STORED_CM;
  return null;
}
