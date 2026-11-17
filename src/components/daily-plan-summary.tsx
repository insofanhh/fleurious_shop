import { ArrowRight, CalendarDays, UserRound } from "lucide-react";
import { dailyStateLabels } from "@/lib/daily-types";
import { money } from "@/lib/time";

export function DailyPlanStatus({ state }: { state: string }) {
  const tone: Record<string, string> = {
    ACTIVE: "active",
    PENDING_PAYMENT: "pending",
    PAUSED: "paused",
    CLOSING: "pending",
    COMPLETED: "complete",
  };
  return (
    <span
      className={`daily-plan-status daily-plan-status--${tone[state] ?? "muted"}`}
      data-state={state}
    >
      {dailyStateLabels[state] ?? state}
    </span>
  );
}
export function dailyDateRange(deliveries: readonly { day: string }[]) {
  const dates = deliveries.map((d) => d.day).sort();
  const format = (day: string) => day.split("-").reverse().join("/");
  if (!dates.length) return "Chưa có ngày giao";
  return dates[0] === dates.at(-1)
    ? format(dates[0])
    : `${format(dates[0])} – ${format(dates.at(-1)!)}`;
}
export function DailyPlanCardContent({
  plan,
  showBuyer = false,
}: {
  plan: {
    code: string;
    recipientName: string;
    buyerName: string;
    state: string;
    total?: number;
    deliveries: readonly { day: string; state: string }[];
  };
  showBuyer?: boolean;
}) {
  const delivered = plan.deliveries.filter(
    (d) => d.state === "FULFILLED",
  ).length;
  return (
    <>
      <div className="daily-plan-card-icon">
        <CalendarDays size={20} strokeWidth={1.5} aria-hidden="true" />
      </div>
      <div className="daily-plan-card-main">
        <div className="daily-plan-card-code">
          <span>{plan.code}</span>
          <DailyPlanStatus state={plan.state} />
        </div>
        <h3>Gửi {plan.recipientName}</h3>
        <div className="daily-plan-card-meta">
          {showBuyer && (
            <span>
              <UserRound size={13} aria-hidden="true" />
              Người đặt: {plan.buyerName}
            </span>
          )}
          <span>
            <CalendarDays size={13} aria-hidden="true" />
            {dailyDateRange(plan.deliveries)}
          </span>
        </div>
        <div className="daily-plan-card-progress">
          <span>
            {delivered}/{plan.deliveries.length} lượt đã giao
          </span>
          <progress
            aria-label="Tiến độ giao hoa"
            max={Math.max(1, plan.deliveries.length)}
            value={delivered}
          />
        </div>
      </div>
      <div className="daily-plan-card-end">
        {plan.total !== undefined && (
          <div>
            <span>Giá trị gói</span>
            <strong>{money(plan.total)}</strong>
          </div>
        )}
        <ArrowRight size={18} aria-hidden="true" />
      </div>
    </>
  );
}
