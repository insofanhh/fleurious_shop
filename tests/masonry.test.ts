import test from "node:test";
import assert from "node:assert/strict";
import { masonryPositions } from "../src/lib/masonry";

test("a new card fills the shortest column instead of waiting for a uniform row", () => {
  const result = masonryPositions(
    [300, 180, 260, 160, 220, 200],
    3,
    200,
    20,
    24,
  );
  assert.deepEqual(result.positions, [
    { left: 0, top: 0 },
    { left: 220, top: 0 },
    { left: 440, top: 0 },
    { left: 220, top: 204 },
    { left: 440, top: 284 },
    { left: 0, top: 324 },
  ]);
  assert.equal(result.height, 524);
});

test("ties start at the left and appending products preserves earlier positions", () => {
  const first = masonryPositions([100, 100, 100, 80], 3, 150, 12, 16);
  assert.deepEqual(first.positions[3], { left: 0, top: 116 });
  const extended = masonryPositions(
    [100, 100, 100, 80, 200, 160],
    3,
    150,
    12,
    16,
  );
  assert.deepEqual(extended.positions.slice(0, 4), first.positions);
});

test("mobile, resized and filtered layouts have exact gutters with no overlaps", () => {
  for (const columns of [1, 2, 3, 4]) {
    const heights = [160.5, 240.25, 310, 135.75, 220, 180.5, 90];
    const { positions, height } = masonryPositions(
      heights,
      columns,
      148.5,
      14,
      25,
    );
    const bottoms = new Map<number, number>();
    positions.forEach((position, i) => {
      assert.equal(
        position.top,
        bottoms.has(position.left) ? bottoms.get(position.left)! + 25 : 0,
      );
      bottoms.set(position.left, position.top + heights[i]);
    });
    assert.equal(height, Math.max(...bottoms.values()));
    assert.equal(
      masonryPositions(heights.slice(2), columns, 148.5, 14, 25).positions[0]
        .top,
      0,
    );
  }
  assert.deepEqual(masonryPositions([], 2, 148.5, 14, 25), {
    positions: [],
    height: 0,
  });
});

test("home preview has at most two cards per column even with very different heights", () => {
  for (const columns of [2, 3, 4]) {
    const { positions } = masonryPositions(
      [600, 10, 20, 30, 40, 50, 60, 70].slice(0, columns * 2),
      columns,
      160,
      12,
      20,
      2,
    );
    const counts = new Map<number, number>();
    for (const { left } of positions)
      counts.set(left, (counts.get(left) ?? 0) + 1);
    assert.deepEqual([...counts.values()], Array(columns).fill(2));
  }
});
