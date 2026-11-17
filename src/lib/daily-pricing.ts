import type { DailyPolicy } from "./daily-types";
import { fail } from "./errors";
import { dayKey, localInstant, shiftDay } from "./time";
export function dailyDay(day: string) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
    !Number.isFinite(Date.parse(`${day}T12:00:00Z`)) ||
    dayKey(new Date(`${day}T12:00:00+07:00`)) !== day
  )
    fail("INVALID_DAY", "Ngày nhận hoa không hợp lệ.");
  return day;
}
export function dailyTier(policy: DailyPolicy, count: number) {
  return [...policy.tiers]
    .sort((a, b) => b.count - a.count)
    .find((t) => count >= t.count);
}
export function dailyAmounts(
  policy: DailyPolicy,
  code: string,
  count: number,
  shipping: number,
  meters: number,
) {
  const budget = policy.budgets.find((b) => b.code === code);
  if (
    (!budget && policy.pricingMode !== "PRODUCT") ||
    !Number.isInteger(count) ||
    count < 1 ||
    count > 31
  )
    fail("DAILY_BUDGET", "Chọn ngân sách và từ 1 đến 31 ngày nhận hoa.");
  const tier = dailyTier(policy, count),
    discount = Math.round(
      ((policy.pricingMode === "PRODUCT" ? 0 : budget!.price) *
        count *
        (tier?.percent ?? 0)) /
        100,
    );
  const subsidy = Math.min(
    shipping,
    tier?.freeMeters && meters <= tier.freeMeters
      ? shipping
      : tier?.freeMeters
        ? Math.max(
            tier.outsideSupport,
            Math.min(
              tier.shipCap,
              Math.floor((shipping * tier.shipPercent) / 100),
            ),
          )
        : Math.min(
            tier?.shipCap ?? 0,
            Math.floor((shipping * (tier?.shipPercent ?? 0)) / 100),
          ),
  );
  return {
    base: policy.pricingMode === "PRODUCT" ? 0 : budget!.price,
    discount,
    subsidy,
    shippingGross: shipping,
    percent: tier?.percent ?? 0,
  };
}
export function dailyLockAt(day: string, policy: DailyPolicy, message = false) {
  return localInstant(
    shiftDay(day, -1),
    message ? policy.messageCutoffHour : policy.cutoffHour,
  );
}
export function validateDailyDates(
  days: { day: string; startHour: number }[],
  policy: DailyPolicy,
  blackouts: string[],
  now = new Date(),
) {
  if (
    !days.length ||
    days.length > 31 ||
    new Set(days.map((d) => d.day)).size !== days.length
  )
    fail("DAILY_DATES", "Chọn từ 1 đến 31 ngày khác nhau.");
  for (const d of days) {
    dailyDay(d.day);
    if (
      d.day > shiftDay(dayKey(now), policy.horizonDays) ||
      blackouts.includes(d.day) ||
      policy.blackoutDates.includes(d.day) ||
      localInstant(d.day, d.startHour).getTime() <
        now.getTime() + policy.leadHours * 3600000 ||
      dailyLockAt(d.day, policy) <= now
    )
      fail(
        "DAILY_DATE_UNAVAILABLE",
        `Ngày ${d.day} không còn đủ điều kiện nhận hoa. Chọn ngày hoặc khung giờ khác.`,
      );
  }
}
export function calendarMonthDays(month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) return [];
  const first = dailyDay(`${month}-01`),
    result: string[] = [];
  for (let day = first; day.startsWith(month); day = shiftDay(day, 1))
    result.push(day);
  return result;
}
