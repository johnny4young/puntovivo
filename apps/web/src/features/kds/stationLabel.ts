/**
 * Station display naming, shared so the board, the column heading and the
 * configuration editor cannot disagree about the same station.
 *
 * The default kitchen ships under the reserved code `main` carrying `main` as
 * its name too, and the UI localizes that placeholder. Two things make the
 * name alone an unsafe marker: an operator may rename the default station, and
 * a custom station under any other code is free to be NAMED `main`, which the
 * API accepts. Keying off the name would relabel that custom station as the
 * default kitchen in one surface while another falls through to its code, so
 * one station ends up with two different names on screen.
 */
export const DEFAULT_STATION_CODE = 'main';

export interface StationIdentity {
  code: string;
  name?: string | null | undefined;
}

/**
 * Resolve what to show for a station. `defaultLabel` is the already-translated
 * name of the default kitchen; it applies only when the code and the name both
 * identify the untouched default.
 */
export function resolveStationLabel(station: StationIdentity, defaultLabel: string): string {
  const name = station.name?.trim();
  const isUntouchedDefault =
    station.code === DEFAULT_STATION_CODE && (!name || name === DEFAULT_STATION_CODE);
  if (isUntouchedDefault) return defaultLabel;
  return name || station.code;
}
