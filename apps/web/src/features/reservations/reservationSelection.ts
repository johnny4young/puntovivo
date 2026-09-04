/** Minimal already-arrived party projection, returned with authoritative table state. */
export interface ArrivedReservationChoice {
  id: string;
  version: number;
  guestName: string;
  partySize: number;
}
/** User selection is tied to the exact reservation version so refreshed edits require new consent. */
export function reservationChoiceKey(row: ArrivedReservationChoice): string {
  return `${row.id}:${row.version}`;
}
