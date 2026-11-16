"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { PackageSearch, RefreshCw } from "lucide-react";
import { request } from "./shop-provider";
import { humanDate } from "@/lib/time";
import type { TrackingResult } from "@/lib/order-tracking";
import { CopyButton } from "./copy-button";
import { OrderJourney } from "./order-journey";
import { journeyState, journeySteps as steps } from "@/lib/order-journey";
import { TrackingPayment } from "./tracking-payment";
import "./order-tracking.css";

const paymentLabels: Record<string, string> = {
  UNPAID: "Chưa xác nhận thanh toán",
  PENDING: "Chờ thanh toán",
  PAID: "Đã thanh toán",
  PARTIALLY_REFUNDED: "Đã hoàn một phần",
  REFUNDED: "Đã hoàn tiền",
};
export function OrderTracking() {
  const params = useSearchParams();
  const initial = params.get("code")?.slice(0, 40) ?? "";
  const [code, setCode] = useState(initial),
    [activeCode, setActiveCode] = useState("");
  const [data, setData] = useState<TrackingResult | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const epoch = useRef(0);
  const load = async (value: string, silent = false) => {
    const current = ++epoch.current;
    if (!silent) {
      setBusy(true);
      setError("");
      setData(null);
    }
    try {
      const result = await request<TrackingResult>("orders/track", {
        code: value,
      });
      if (epoch.current === current) {
        setData(result);
        setActiveCode(result.code);
        setError("");
      }
    } catch (e) {
      if (epoch.current === current) setError((e as Error).message);
    } finally {
      if (epoch.current === current) setBusy(false);
    }
  };
  useEffect(() => {
    if (initial) void load(initial);
    return () => {
      ++epoch.current;
    };
  }, [initial]);
  useEffect(() => {
    if (!activeCode) return;
    const update = () => {
      if (document.visibilityState === "visible") void load(activeCode, true);
    };
    const timer = setInterval(update, paymentOpen ? 8000 : 30000);
    window.addEventListener("focus", update);
    window.addEventListener("fleurious:sync", update);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", update);
      window.removeEventListener("fleurious:sync", update);
    };
  }, [activeCode, paymentOpen]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (code.trim()) {
      setActiveCode("");
      setPaymentOpen(false);
      void load(code.trim());
    }
  };
  const { current } = journeyState(
    data ?? { status: "PENDING", fulfillment: "UNASSIGNED" },
  );
  return (
    <section className="container tracking-page">
      <div className="tracking-intro">
        <span className="eyebrow">FLEURIOUS · HÀNH TRÌNH CỦA HOA</span>
        <h1>
          Theo dõi <em>đơn hoa.</em>
        </h1>
        <p>Nhập mã đơn cửa hàng gửi để xem hoa đã đi đến đâu.</p>
      </div>
      <form className="tracking-search" onSubmit={submit}>
        <label>
          Mã đơn hàng
          <div>
            <PackageSearch size={20} />
            <input
              aria-label="Mã đơn hàng"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={40}
              value={code}
              placeholder="Ví dụ: FLR…"
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              required
            />
          </div>
        </label>
        <button className="button glass-primary" disabled={busy}>
          {busy ? "Đang tìm đơn…" : "Tra cứu đơn hàng"}
        </button>
      </form>
      <p className="tracking-privacy">
        Không cần đăng nhập. Thông tin người mua, người nhận và lời nhắn trên
        thiệp được giữ riêng tư.
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {data && (
        <article className="tracking-result" aria-label="Kết quả tra cứu">
          <div className="tracking-result-heading">
            <div>
              <span className="eyebrow">ĐƠN HOA CỦA BẠN</span>
              <h2>
                {data.code}
                <CopyButton value={data.code} />
              </h2>
            </div>
            <button
              type="button"
              className="icon-button"
              aria-label="Cập nhật tiến trình"
              onClick={() => load(data.code, true)}
            >
              <RefreshCw size={18} />
            </button>
          </div>
          <div className="tracking-badges">
            <span className="status-tag tracking-status">
              {data.expired
                ? "Đơn hết hạn"
                : data.status === "CANCELLED"
                  ? "Đã hủy"
                  : data.status === "REFUND_PENDING"
                    ? "Chờ hoàn tiền"
                    : data.status === "REFUNDED"
                      ? "Đã hoàn tiền"
                      : (steps[Math.max(0, current)]?.label ?? "Đang cập nhật")}
            </span>
            <span className="status-tag">
              {paymentLabels[data.paymentStatus] ?? "Đang cập nhật thanh toán"}
            </span>
            {data.paymentOverdue && !data.expired && (
              <span className="status-tag">
                Quá hạn thanh toán · Liên hệ cửa hàng
              </span>
            )}
            {data.canPay && (
              <button
                type="button"
                className="text-link tracking-pay-link"
                onClick={() => setPaymentOpen(true)}
              >
                Tiến hành thanh toán <span aria-hidden="true">→</span>
              </button>
            )}
          </div>
          {paymentOpen && (
            <TrackingPayment
              key={data.code}
              order={data}
              onClose={() => setPaymentOpen(false)}
            />
          )}
          <OrderJourney
            status={data.status}
            fulfillment={data.fulfillment}
            expired={data.expired}
          />
          <dl className="tracking-dates">
            <div>
              <dt>Ngày tạo</dt>
              <dd>{humanDate(data.createdAt)}</dd>
            </div>
            <div>
              <dt>Lịch giao dự kiến · Hà Nội</dt>
              <dd>
                {data.deliveryDay.split("-").reverse().join("/")} ·{" "}
                {data.slotLabel}
              </dd>
            </div>
            {data.deliveredAt && (
              <div>
                <dt>Đã giao lúc</dt>
                <dd>{humanDate(data.deliveredAt)}</dd>
              </div>
            )}
          </dl>
          <div className="tracking-products">
            {data.items.map((item, index) => (
              <div key={index}>
                <img src={item.image} alt={item.name} width={56} height={68} />
                <span>
                  <strong>{item.name}</strong>
                  <small>
                    {item.variantName} · Số lượng {item.quantity}
                  </small>
                </span>
              </div>
            ))}
          </div>
          <small className="tracking-updated">
            Cập nhật lúc {humanDate(data.serverNow)} · Giờ Hà Nội
          </small>
        </article>
      )}
    </section>
  );
}
