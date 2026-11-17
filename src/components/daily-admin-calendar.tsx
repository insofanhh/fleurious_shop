"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  MapPin,
  Phone,
  RefreshCw,
} from "lucide-react";
import { request } from "./shop-provider";
import { shiftMonth } from "./daily-calendar";
import { calendarMonthDays } from "@/lib/daily-pricing";
import { dayKey, monthKey } from "@/lib/time";
import type { DailyCalendarMonth } from "@/lib/daily-calendar";
import "./daily-admin-calendar.css";

const stages: Record<string, { label: string; tone: string }> = {
  SCHEDULED: { label: "Đã lên lịch", tone: "scheduled" },
  NEEDS_APPROVAL: { label: "Chờ duyệt mẫu", tone: "attention" },
  ATTENTION: { label: "Cần hỗ trợ", tone: "attention" },
  UNASSIGNED: { label: "Chờ chuẩn bị", tone: "scheduled" },
  PREPARING: { label: "Đang chuẩn bị", tone: "progress" },
  READY: { label: "Sẵn sàng giao", tone: "progress" },
  OUT_FOR_DELIVERY: { label: "Đang giao", tone: "progress" },
  FULFILLED: { label: "Đã giao", tone: "delivered" },
};
const formatDay = (day: string) => day.split("-").reverse().join("/");
export function DailyAdminCalendar({
  role,
  onOpenPlan,
  initialView,
  onViewChange,
}: {
  role: string;
  onOpenPlan: (id: string, deliveryId: string) => void;
  initialView: { month: string; date: string };
  onViewChange: (view: { month: string; date: string }) => void;
}) {
  const [month, setMonth] = useState(initialView.month),
    [date, setDate] = useState(initialView.date),
    [data, setData] = useState<DailyCalendarMonth | null>(null),
    [checking, setChecking] = useState(false),
    [error, setError] = useState("");
  const epoch = useRef(0);
  const load = useCallback(async () => {
    const current = ++epoch.current;
    setChecking(true);
    try {
      const result = await request<DailyCalendarMonth>(
        `admin/daily/calendar?month=${month}`,
      );
      if (current === epoch.current) {
        setData(result);
        setError("");
      }
    } catch (e) {
      if (current === epoch.current) setError((e as Error).message);
    } finally {
      if (current === epoch.current) setChecking(false);
    }
  }, [month]);
  useEffect(() => {
    void load();
    const interval = setInterval(load, 20000);
    window.addEventListener("fleurious:sync", load);
    window.addEventListener("focus", load);
    return () => {
      ++epoch.current;
      clearInterval(interval);
      window.removeEventListener("fleurious:sync", load);
      window.removeEventListener("focus", load);
    };
  }, [load]);
  const rows = data?.month === month ? data.rows : [];
  const byDay = new Map<string, typeof rows>();
  for (const row of rows)
    byDay.set(row.day, [...(byDay.get(row.day) ?? []), row]);
  const days = calendarMonthDays(month),
    today = data?.today ?? dayKey(),
    offset = (new Date(`${month}-01T12:00:00Z`).getUTCDay() + 6) % 7;
  const selected = [...(byDay.get(date) ?? [])].sort(
    (a, b) => Number(a.stage === "FULFILLED") - Number(b.stage === "FULFILLED"),
  );
  const completed = rows.filter((r) => r.stage === "FULFILLED").length;
  const attention = rows.filter((r) =>
    ["NEEDS_APPROVAL", "ATTENTION"].includes(r.stage),
  ).length;
  const pendingDay = selected.filter((r) => r.stage !== "FULFILLED").length;
  function changeMonth(value: string) {
    setMonth(value);
    const day = value === monthKey() ? dayKey() : `${value}-01`;
    setDate(day);
    onViewChange({ month: value, date: day });
  }
  const monthTitle = new Intl.DateTimeFormat("vi-VN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${month}-01T12:00:00Z`));
  return (
    <section className="daily-dispatch" aria-label="Lịch giao Hoa mỗi ngày">
      <div className="daily-dispatch-intro">
        <div>
          <h2>Lịch những ngày có hoa</h2>
          <p>
            Bấm ngày để xem người nhận và các lượt cần chuẩn bị, kể cả lịch chưa
            tạo đơn.
          </p>
        </div>
        <span className="daily-dispatch-refresh" role="status">
          {checking ? "Đang cập nhật…" : "Giờ Hà Nội"}
        </span>
      </div>
      <div className="daily-dispatch-stats">
        <span>
          <strong>{byDay.size}</strong> ngày có lịch
        </span>
        <span>
          <strong>{rows.length - completed}</strong> lượt cần giao
        </span>
        <span>
          <strong>{completed}</strong> lượt đã giao
        </span>
        <span>
          <strong>{attention}</strong> chờ duyệt / cần hỗ trợ
        </span>
      </div>
      {error && (
        <div className="notice" role="alert">
          {error}{" "}
          <button
            type="button"
            className="text-link"
            onClick={() => void load()}
          >
            <RefreshCw size={14} /> Thử lại
          </button>
        </div>
      )}
      <div className="daily-dispatch-layout">
        <div className="daily-dispatch-calendar">
          <div className="daily-dispatch-calendar-heading">
            <div className="daily-dispatch-month-nav">
              <button
                type="button"
                className="icon-button"
                aria-label="Tháng trước"
                onClick={() => changeMonth(shiftMonth(month, -1))}
              >
                <ChevronLeft size={17} />
              </button>
              <h3>{monthTitle}</h3>
              <button
                type="button"
                className="icon-button"
                aria-label="Tháng sau"
                onClick={() => changeMonth(shiftMonth(month, 1))}
              >
                <ChevronRight size={17} />
              </button>
            </div>
            <button
              type="button"
              className="text-link"
              onClick={() => changeMonth(monthKey())}
            >
              Hôm nay
            </button>
          </div>
          <div
            className="daily-dispatch-grid"
            role="group"
            aria-label="Ngày giao trong tháng"
          >
            {["T2", "T3", "T4", "T5", "T6", "T7", "CN"].map((day) => (
              <span className="daily-dispatch-weekday" key={day}>
                {day}
              </span>
            ))}
            {Array.from({ length: offset }, (_, i) => (
              <span key={`offset-${i}`} />
            ))}
            {days.map((day) => {
              const deliveries = byDay.get(day) ?? [],
                done = deliveries.filter((r) => r.stage === "FULFILLED").length,
                pending = deliveries.length - done,
                needsHelp = deliveries.some((r) =>
                  ["ATTENTION", "NEEDS_APPROVAL"].includes(r.stage),
                );
              return (
                <button
                  key={day}
                  type="button"
                  className={`daily-dispatch-day${deliveries.length ? " has-deliveries" : ""}${deliveries.length && done === deliveries.length ? " all-delivered" : ""}${date === day ? " selected" : ""}${day === today ? " today" : ""}`}
                  aria-pressed={date === day}
                  aria-label={`${day}: ${pending} lượt cần giao, ${done} đã giao`}
                  onClick={() => {
                    setDate(day);
                    onViewChange({ month, date: day });
                  }}
                >
                  <span className="daily-dispatch-day-top">
                    <span className="daily-dispatch-day-number">
                      {Number(day.slice(-2))}
                    </span>
                    {deliveries.length > 0 && (
                      <span className="daily-dispatch-day-count">
                        {pending ? `${pending} lượt` : "Đã giao"}
                        {needsHelp && <i aria-label="Có lượt cần hỗ trợ" />}
                      </span>
                    )}
                  </span>
                  <span className="daily-dispatch-day-names" aria-hidden="true">
                    {deliveries.slice(0, 2).map((r) => (
                      <span key={r.id}>{r.recipientName}</span>
                    ))}
                    {deliveries.length > 2 && (
                      <small>+{deliveries.length - 2} người nhận</small>
                    )}
                  </span>
                  {done > 0 && pending > 0 && (
                    <small className="daily-dispatch-day-done">
                      {done} đã giao
                    </small>
                  )}
                </button>
              );
            })}
          </div>
          <div className="daily-dispatch-legend">
            <span>
              <i /> Có lịch giao
            </span>
            <span>
              <i className="attention" /> Cần duyệt / hỗ trợ
            </span>
            <span>
              <i className="delivered" /> Đã giao
            </span>
          </div>
        </div>
        <div
          className="daily-dispatch-agenda"
          aria-busy={checking && data?.month !== month}
        >
          <div className="daily-dispatch-agenda-heading">
            <div>
              <span>LỊCH NGÀY</span>
              <h3>{formatDay(date)}</h3>
              <p>
                {pendingDay} lượt cần giao · {selected.length - pendingDay} đã
                giao
              </p>
            </div>
            {["OWNER", "MANAGER", "FLORIST"].includes(role) && (
              <a
                className="button secondary"
                href={`/api/admin/daily/export?day=${date}`}
                download
              >
                <Download size={14} /> Phiếu chuẩn bị
              </a>
            )}
          </div>
          <div
            className="daily-dispatch-deliveries"
            aria-label={`Người nhận ngày ${formatDay(date)}`}
          >
            {!selected.length && (
              <div className="daily-dispatch-empty">
                <CalendarDays size={26} strokeWidth={1.4} />
                <strong>
                  {checking && data?.month !== month
                    ? "Đang tải lịch giao…"
                    : "Ngày này chưa có lượt giao."}
                </strong>
                <p>Chọn một ngày có đánh dấu để xem người nhận.</p>
              </div>
            )}
            {selected.map((row) => {
              const status = stages[row.stage] ?? stages.SCHEDULED;
              return (
                <article className="daily-dispatch-delivery" key={row.id}>
                  <div className="daily-dispatch-recipient">
                    <div>
                      <span>Người nhận</span>
                      <h4>{row.recipientName}</h4>
                    </div>
                    <span className={`daily-dispatch-status ${status.tone}`}>
                      {status.label}
                    </span>
                  </div>
                  <div className="daily-dispatch-slot">
                    <Clock3 size={14} />
                    {row.slotLabel}
                  </div>
                  <div className="daily-dispatch-flower">
                    {row.flower.image && (
                      <img
                        src={row.flower.image}
                        alt=""
                        width="44"
                        height="52"
                        loading="lazy"
                      />
                    )}
                    <div>
                      <strong>{row.flower.name}</strong>
                      {row.flower.size && <span>Size {row.flower.size}</span>}
                    </div>
                  </div>
                  {row.address && (
                    <p className="daily-dispatch-address">
                      <MapPin size={14} />
                      <span>{row.address}</span>
                    </p>
                  )}
                  {row.recipientPhone && (
                    <a
                      className="daily-dispatch-phone"
                      href={`tel:${row.recipientPhone}`}
                    >
                      <Phone size={13} />
                      {row.recipientPhone}
                    </a>
                  )}
                  {row.issue && (
                    <p className="daily-dispatch-issue">{row.issue}</p>
                  )}
                  <div className="daily-dispatch-delivery-footer">
                    <span>
                      {row.planCode} · Người đặt: {row.buyerName}
                    </span>
                    <div>
                      <button
                        type="button"
                        className="text-link"
                        onClick={() => onOpenPlan(row.planId, row.id)}
                      >
                        Xem gói <ArrowRight size={13} />
                      </button>
                      {row.order && (
                        <Link
                          className="text-link"
                          href={`/admin/orders?q=${row.order.code}`}
                        >
                          Mở đơn <ArrowRight size={13} />
                        </Link>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
