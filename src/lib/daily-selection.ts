import { createHash } from "node:crypto";
import { fail } from "./errors";

type Flower = { id: string; productId: string; priority?: number };
export function allocateDailyFlowers<T extends Flower>(
  days: readonly { day: string; offeringId?: string; choices: readonly T[] }[],
  seed: string,
) {
  const products = new Map<string, number>(),
    offerings = new Map<string, number>();
  const count = (flower: Flower) => {
    products.set(flower.productId, (products.get(flower.productId) ?? 0) + 1);
    offerings.set(flower.id, (offerings.get(flower.id) ?? 0) + 1);
  };
  // Fixed customer choices count toward the distribution but are never replaced.
  for (const d of days)
    if (d.offeringId) {
      const flower = d.choices.find((o) => o.id === d.offeringId);
      if (!flower)
        fail(
          "DAILY_OFFERING",
          `Mẫu đã chọn ngày ${d.day} không còn phù hợp hoặc đã đủ lịch.`,
          409,
        );
      count(flower);
    }
  let previous = "";
  return days.map((d) => {
    const rank = (id: string) =>
      createHash("sha256").update(`${seed}:${d.day}:${id}`).digest("hex");
    const flower = d.offeringId
      ? d.choices.find((o) => o.id === d.offeringId)
      : [...d.choices].sort(
          (a, b) =>
            (products.get(a.productId) ?? 0) -
              (products.get(b.productId) ?? 0) ||
            Number(a.productId === previous) -
              Number(b.productId === previous) ||
            (offerings.get(a.id) ?? 0) - (offerings.get(b.id) ?? 0) ||
            (b.priority ?? 0) - (a.priority ?? 0) ||
            rank(a.id).localeCompare(rank(b.id)),
        )[0];
    if (!flower)
      fail(
        "DAILY_POOL_EMPTY",
        `Chưa có mẫu phù hợp ngày ${d.day}. Thử lịch khác hoặc liên hệ cửa hàng.`,
        409,
      );
    if (!d.offeringId) count(flower);
    previous = flower.productId;
    return { day: d.day, offeringId: flower.id };
  });
}
