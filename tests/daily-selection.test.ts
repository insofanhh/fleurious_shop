import test from "node:test";
import assert from "node:assert/strict";
import { allocateDailyFlowers } from "../src/lib/daily-selection";

const flowers = ["rose", "tulip", "daisy", "lily"].map((id) => ({
  id,
  productId: id,
}));
const dates = (length: number) =>
  Array.from({ length }, (_, i) => ({
    day: `2027-01-${String(i + 1).padStart(2, "0")}`,
    choices: flowers,
  }));

test("Daily automatic selection balances 1–31 days without repeating before a full cycle", () => {
  for (let length = 1; length <= 31; length++) {
    const result = allocateDailyFlowers(dates(length), "daily-cycle");
    const counts = flowers.map(
      (f) => result.filter((d) => d.offeringId === f.id).length,
    );
    assert(Math.max(...counts) - Math.min(...counts) <= 1);
    for (let i = 0; i < length; i += flowers.length)
      assert.equal(
        new Set(result.slice(i, i + flowers.length).map((d) => d.offeringId))
          .size,
        Math.min(flowers.length, length - i),
      );
    for (let i = 1; i < length; i++)
      assert.notEqual(result[i].offeringId, result[i - 1].offeringId);
  }
});

test("Daily selection is stable for a seed and can suggest a different distribution", () => {
  const result = allocateDailyFlowers(dates(10), "seed-a");
  assert.deepEqual(allocateDailyFlowers(dates(10), "seed-a"), result);
  assert.notDeepEqual(allocateDailyFlowers(dates(10), "seed-b"), result);
});

test("Daily custom days remain fixed and count toward an even distribution", () => {
  const days = dates(12).map((d, i) => ({
    ...d,
    offeringId: i < 3 ? "rose" : undefined,
  }));
  const result = allocateDailyFlowers(days, "pins");
  assert(result.slice(0, 3).every((d) => d.offeringId === "rose"));
  for (const f of flowers)
    assert.equal(result.filter((d) => d.offeringId === f.id).length, 3);
});

test("Daily balances products before variants and respects each day's available pool", () => {
  const variants = [...flowers, { id: "rose-large", productId: "rose" }];
  const result = allocateDailyFlowers(
    dates(24).map((d) => ({ ...d, choices: variants })),
    "variants",
  );
  const products = result.map(
    (d) => variants.find((v) => v.id === d.offeringId)!.productId,
  );
  for (const f of flowers)
    assert.equal(products.filter((p) => p === f.id).length, 6);
  assert.equal(result.filter((d) => d.offeringId === "rose-large").length, 3);
  const limited = dates(5).map((d, i) => ({
    ...d,
    choices: i === 1 ? [flowers[0]] : flowers,
  }));
  assert.equal(allocateDailyFlowers(limited, "limited")[1].offeringId, "rose");
  assert.throws(
    () =>
      allocateDailyFlowers([{ ...limited[1], offeringId: "lily" }], "invalid"),
    { code: "DAILY_OFFERING" },
  );
  assert.throws(
    () => allocateDailyFlowers([{ ...limited[1], choices: [] }], "empty"),
    { code: "DAILY_POOL_EMPTY" },
  );
});
