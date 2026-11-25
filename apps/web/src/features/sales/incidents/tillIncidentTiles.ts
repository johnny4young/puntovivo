import {
  Ban,
  Banknote,
  Barcode,
  BellRing,
  PackageX,
  Printer,
  ScanBarcode,
  Tag,
  Undo2,
  type LucideIcon,
} from 'lucide-react';

/** Tiles that hand over to a register flow the screen already owns. */
export type TillIncidentAction = 'returns' | 'voidSale' | 'cashMovement' | 'reprint';
/** Tiles that open a short report form. */
export type TillIncidentReportKind = 'stockout' | 'noBarcode' | 'priceMismatch';
export type TillIncidentTileId =
  TillIncidentAction | TillIncidentReportKind | 'priceCheck' | 'callManager';

export interface TillIncidentTile {
  id: TillIncidentTileId;
  /** Same key in every language, so a trained hand does not change with the locale. */
  letter: string;
  icon: LucideIcon;
}

export const TILL_INCIDENT_GROUPS: ReadonlyArray<{
  id: 'customer' | 'product' | 'register';
  tiles: readonly TillIncidentTile[];
}> = [
  {
    id: 'customer',
    tiles: [
      { id: 'returns', letter: 'D', icon: Undo2 },
      { id: 'voidSale', letter: 'A', icon: Ban },
      { id: 'priceCheck', letter: 'P', icon: Tag },
    ],
  },
  {
    id: 'product',
    tiles: [
      { id: 'stockout', letter: 'G', icon: PackageX },
      { id: 'noBarcode', letter: 'S', icon: Barcode },
      { id: 'priceMismatch', letter: 'C', icon: ScanBarcode },
    ],
  },
  {
    id: 'register',
    tiles: [
      { id: 'cashMovement', letter: 'M', icon: Banknote },
      { id: 'reprint', letter: 'R', icon: Printer },
      { id: 'callManager', letter: 'L', icon: BellRing },
    ],
  },
];

const TILES = new Map(
  TILL_INCIDENT_GROUPS.flatMap(group => group.tiles).map(tile => [tile.id, tile])
);
const ACTIONS: ReadonlySet<TillIncidentTileId> = new Set<TillIncidentAction>([
  'returns',
  'voidSale',
  'cashMovement',
  'reprint',
]);

export function isTillIncidentAction(id: TillIncidentTileId): id is TillIncidentAction {
  return ACTIONS.has(id);
}

export function tillIncidentTileForKey(key: string): TillIncidentTile | undefined {
  const letter = key.toUpperCase();
  return [...TILES.values()].find(tile => tile.letter === letter);
}

export function tillIncidentTile(id: TillIncidentTileId): TillIncidentTile {
  return TILES.get(id)!;
}
