/** One path of horizontal runs, so the SVG stays small and never needs innerHTML. */
export function qrModulesPath(size: number, data: ArrayLike<number>): string {
  let path = '';
  for (let row = 0; row < size; row += 1) {
    let column = 0;
    while (column < size) {
      if (!data[row * size + column]) {
        column += 1;
        continue;
      }
      const start = column;
      while (column < size && data[row * size + column]) column += 1;
      path += `M${start} ${row}h${column - start}v1h${start - column}z`;
    }
  }
  return path;
}
