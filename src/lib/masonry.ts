/** Place items in data order into the leftmost of the shortest columns. */
export function masonryPositions(
  heights: readonly number[],
  columnCount: number,
  columnWidth: number,
  columnGap: number,
  rowGap: number,
  maxItemsPerColumn = Number.POSITIVE_INFINITY,
) {
  const columns = Array.from({ length: columnCount }, () => 0);
  const counts = columns.map(() => 0);
  const positions = heights.map((height) => {
    const eligible = columns.map((top, index) =>
      counts[index] < maxItemsPerColumn ? top : Number.POSITIVE_INFINITY,
    );
    const shortest = Math.min(...eligible);
    const column =
      shortest === Number.POSITIVE_INFINITY
        ? columns.indexOf(Math.min(...columns))
        : eligible.indexOf(shortest);
    const top = columns[column];
    counts[column]++;
    columns[column] = top + height + rowGap;
    return { left: column * (columnWidth + columnGap), top };
  });
  return {
    positions,
    height: heights.length ? Math.max(...columns) - rowGap : 0,
  };
}
