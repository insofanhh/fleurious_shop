import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { TIMEZONE } from "./time";

/** Calendar anniversaries retain the original day even after February's clamp. */
export function addMembershipMonths(anchor: Date, months: number): Date {
  const [y, m, d, h, minute, second, ms] = formatInTimeZone(
    anchor,
    TIMEZONE,
    "yyyy MM dd HH mm ss SSS",
  )
    .split(" ")
    .map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const year = target.getUTCFullYear(),
    month = target.getUTCMonth();
  const day = Math.min(d, new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
  const pad = (value: number, size = 2) => String(value).padStart(size, "0");
  return fromZonedTime(
    `${year}-${pad(month + 1)}-${pad(day)}T${pad(h)}:${pad(minute)}:${pad(second)}.${pad(ms, 3)}`,
    TIMEZONE,
  );
}

export function nextMembershipEnd(
  anchor: Date,
  start: Date,
  months: number,
): Date {
  for (let offset = 0; offset < 1200; offset += months) {
    const end = addMembershipMonths(anchor, offset + months);
    if (end > start) return end;
  }
  throw new Error("Không thể xác định kỳ hội viên.");
}
