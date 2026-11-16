"use client";
import { Copy, Clock3 } from "lucide-react";
import { useDeadline } from "./use-deadline";
import { formatCountdown } from "@/lib/order-expiry";
import { money, humanDate } from "@/lib/time";
import { useShop } from "./shop-provider";
export function PaymentQr({
  url,
  amount,
  code,
  bank,
  accountNumber,
  accountName,
  expiresAt,
  serverNow,
  title = "Một bước nữa để gửi hoa.",
}: {
  url: string;
  amount: number;
  code: string;
  bank?: string;
  accountNumber?: string;
  accountName?: string;
  expiresAt?: string;
  serverNow?: string;
  title?: string;
}) {
  const { toast } = useShop();
  const seconds = useDeadline(expiresAt, serverNow);
  if (seconds === 0)
    return (
      <section className="payment-card payment-expired" role="status">
        <Clock3 size={24} />
        <h2>Hết thời gian thanh toán.</h2>
        <p>
          Yêu cầu thanh toán đã hết hạn. Vui lòng tạo yêu cầu mới để kiểm tra
          lại thông tin.
        </p>
      </section>
    );
  return (
    <section className="payment-card" aria-label="Thông tin thanh toán SePay">
      <span className="eyebrow">QR THANH TOÁN · SEPAY</span>
      {title && <h2>{title}</h2>}
      <div className="payment-card-body">
        <div className="payment-card-qr">
          <img
            src={url}
            alt={`QR SePay thanh toán ${money(amount)} cho ${code}`}
            width="300"
            height="360"
            referrerPolicy="no-referrer"
          />
        </div>
        <div className="payment-card-information">
          {expiresAt ? (
            <div
              className={`payment-countdown ${seconds !== null && seconds <= 60 ? "urgent" : ""}`}
            >
              <Clock3 size={16} aria-hidden="true" />
              <span>Thời gian thanh toán còn lại</span>
              <strong
                role="timer"
                aria-live="off"
                aria-label="Thời gian thanh toán còn lại"
              >
                {seconds === null ? "--:--" : formatCountdown(seconds)}
              </strong>
            </div>
          ) : (
            <p className="payment-countdown">
              Không giới hạn thời gian thanh toán · Đến khi cửa hàng đóng đơn
            </p>
          )}
          <div className="payment-card-amount">
            <span>Số tiền chuyển khoản</span>
            <strong>{money(amount)}</strong>
          </div>
          <dl className="payment-card-details">
            {[
              ["Ngân hàng", bank],
              ["Số tài khoản", accountNumber],
              ["Chủ tài khoản", accountName],
              ["Nội dung", code],
            ].map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>
                  <strong>{value || "—"}</strong>
                  {value && (
                    <button
                      type="button"
                      aria-label={`Sao chép ${label?.toLowerCase()}`}
                      title="Sao chép"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(value);
                          toast(`Đã sao chép ${label?.toLowerCase()}.`);
                        } catch {
                          toast(
                            "Chưa sao chép được. Vui lòng chọn nội dung và sao chép thủ công.",
                          );
                        }
                      }}
                    >
                      <Copy size={15} />
                    </button>
                  )}
                </dd>
              </div>
            ))}
          </dl>
          <p className="payment-card-note" role="status">
            Chuyển đúng số tiền và nội dung
            {expiresAt ? ` trước ${humanDate(expiresAt)}` : ""}. Trang tự cập
            nhật khi SePay xác nhận.
          </p>
        </div>
      </div>
    </section>
  );
}
