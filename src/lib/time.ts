import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
export const TIMEZONE = "Asia/Ho_Chi_Minh";
export const TIMEZONE_LABEL = "Hà Nội · UTC+7";
export const dayKey = (date = new Date()) =>
  formatInTimeZone(date, TIMEZONE, "yyyy-MM-dd");
export const monthKey = (date = new Date()) =>
  formatInTimeZone(date, TIMEZONE, "yyyy-MM");
export const localInstant = (day: string, hour = 0) =>
  fromZonedTime(`${day}T${String(hour).padStart(2, "0")}:00:00`, TIMEZONE);
export const shiftDay = (day: string, amount: number) =>
  new Date(Date.parse(`${day}T12:00:00Z`) + amount * 86400000)
    .toISOString()
    .slice(0, 10);
export const money = (value: number) =>
  new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(value);
export const humanDate = (date: Date | string) =>
  new Intl.DateTimeFormat("vi-VN", {
    timeZone: TIMEZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
export function streakStats(days: string[], today = dayKey()) {
  const unique = [...new Set(days.filter((d) => d <= today))].sort();
  let longest = 0,
    run = 0,
    previous = "";
  for (const day of unique) {
    run = previous && shiftDay(previous, 1) === day ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = day;
  }
  const last = unique.at(-1);
  const current = last === today || last === shiftDay(today, -1) ? run : 0;
  return {
    current,
    longest,
    monthly: unique.filter((d) => d.startsWith(today.slice(0, 7))).length,
    todayActive: unique.includes(today),
  };
}
