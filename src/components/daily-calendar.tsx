"use client";
import { ChevronLeft, ChevronRight, Check } from "lucide-react";
import { calendarMonthDays } from "@/lib/daily-pricing";
export function shiftMonth(month: string, amount: number) {
  const d = new Date(`${month}-01T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + amount);
  return d.toISOString().slice(0, 7);
}
export function DailyCalendar({
  month,
  onMonth,
  selected = {},
  disabled = [],
  onDay,
  readOnly = false,
  activeDay,
}: {
  month: string;
  onMonth: (v: string) => void;
  selected?: Record<
    string,
    { image?: string; state?: string; pending?: boolean }
  >;
  disabled?: string[];
  onDay?: (day: string) => void;
  readOnly?: boolean;
  activeDay?: string;
}) {
  const days = calendarMonthDays(month),
    offset = (new Date(`${month}-01T12:00:00Z`).getUTCDay() + 6) % 7;
  return (
    <div className="daily-calendar">
      <div className="daily-calendar-heading">
        <button
          type="button"
          className="icon-button"
          aria-label="Tháng trước"
          onClick={() => onMonth(shiftMonth(month, -1))}
        >
          <ChevronLeft size={18} />
        </button>
        <strong>
          {new Intl.DateTimeFormat("vi-VN", {
            month: "long",
            year: "numeric",
            timeZone: "UTC",
          }).format(new Date(`${month}-01T12:00:00Z`))}
        </strong>
        <button
          type="button"
          className="icon-button"
          aria-label="Tháng sau"
          onClick={() => onMonth(shiftMonth(month, 1))}
        >
          <ChevronRight size={18} />
        </button>
      </div>
      <div
        className="daily-calendar-grid"
        role="group"
        aria-label="Lịch nhận hoa"
      >
        {["T2", "T3", "T4", "T5", "T6", "T7", "CN"].map((t) => (
          <span className="daily-weekday" key={t}>
            {t}
          </span>
        ))}
        {Array.from({ length: offset }, (_, i) => (
          <span key={`space${i}`} />
        ))}
        {days.map((day) => {
          const s = selected[day];
          return (
            <button
              type="button"
              key={day}
              disabled={disabled.includes(day) || (readOnly && !s)}
              aria-label={`${day}${s ? `, ${s.state ?? "Đã chọn"}` : ""}`}
              aria-pressed={activeDay ? activeDay === day : !!s}
              className={`daily-day ${s ? "selected" : ""} ${s?.image ? "with-image" : ""} ${s?.pending ? "needs-selection" : ""} ${activeDay === day ? "active" : ""}`}
              onClick={() => onDay?.(day)}
            >
              {s?.image && (
                <img
                  src={s.image}
                  alt=""
                  width="80"
                  height="80"
                  loading="lazy"
                />
              )}
              <span>{Number(day.slice(-2))}</span>
              {s && !s.pending && <Check size={12} aria-hidden="true" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
