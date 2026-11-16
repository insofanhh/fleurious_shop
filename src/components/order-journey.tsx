import { FlowerIcon } from "./flower-icon";
import { Check, Clock3, Truck, PackageCheck } from "lucide-react";
import { journeyState, journeySteps } from "@/lib/order-journey";
import "./order-journey.css";
const icons = [Clock3, Check, FlowerIcon, PackageCheck, Truck, Check];
export function OrderJourney(props: {
  status: string;
  fulfillment: string;
  expired?: boolean;
}) {
  const { current, stopped, animateNext } = journeyState(props);
  if (stopped)
    return (
      <p className="journey-stopped" role="status">
        {props.expired
          ? "Đơn đã hết hạn. Liên hệ Fleurious để được hỗ trợ đặt lại."
          : props.status === "CANCELLED"
            ? "Đơn đã hủy. Liên hệ cửa hàng nếu bạn cần hỗ trợ."
            : props.status === "REFUND_PENDING"
              ? "Đơn đang được xử lý hoàn tiền."
              : "Đơn đã được hoàn tiền."}
      </p>
    );
  return (
    <ol className="order-journey" aria-label="Hành trình của hoa">
      {journeySteps.map(({ id, label }, index) => {
        const Icon = icons[index];
        return (
          <li
            key={id}
            className={`${index <= current ? "done" : ""} ${index === current ? "current" : ""}`}
            aria-current={index === current ? "step" : undefined}
          >
            {index < journeySteps.length - 1 && (
              <span
                aria-hidden="true"
                className={`journey-line ${index === current && animateNext ? "running" : ""}`}
              />
            )}
            <span className="journey-icon">
              <Icon size={19} aria-hidden="true" />
            </span>
            <span className="journey-label">
              {label}
              {index === current && <small>Trạng thái hiện tại</small>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
