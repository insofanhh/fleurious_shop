"use client";
import { useEffect, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import { request } from "./shop-provider";
import { PaymentQr } from "./payment-qr";
import type {
  TrackingResult,
  TrackingPaymentResult,
} from "@/lib/order-tracking";
export function TrackingPayment({
  order,
  onClose,
}: {
  order: TrackingResult;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [payment, setPayment] = useState<TrackingPaymentResult | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close();
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);
  useEffect(() => {
    if (!order.canPay) return;
    let alive = true;
    request<TrackingPaymentResult>("orders/track/payment", { code: order.code })
      .then((value) => {
        if (alive) {
          setPayment(value);
          setError("");
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [order.code, order.serverNow, order.canPay, revision]);
  const paid =
    ["PAID", "PARTIALLY_REFUNDED"].includes(order.paymentStatus) &&
    !["CANCELLED", "REFUND_PENDING", "REFUNDED"].includes(order.status);
  return (
    <dialog
      ref={ref}
      className="tracking-payment-modal"
      aria-labelledby="tracking-payment-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const r = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            onClose();
        }
      }}
    >
      <header>
        <h2 id="tracking-payment-title">Thanh toán đơn {order.code}</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="Đóng thanh toán"
          onClick={onClose}
          autoFocus
        >
          <X size={20} />
        </button>
      </header>
      {paid ? (
        <div className="tracking-payment-success" role="status">
          <Check size={28} />
          <h3>Đã thanh toán thành công.</h3>
          <p>
            Fleurious đã xác nhận thanh toán. Hành trình đơn hoa đã được cập
            nhật.
          </p>
          <button className="button secondary" onClick={onClose}>
            Xem hành trình hoa
          </button>
        </div>
      ) : !order.canPay ? (
        <p role="status">
          Đơn không còn nhận thanh toán theo QR này. Vui lòng liên hệ cửa hàng
          để được hỗ trợ.
        </p>
      ) : error ? (
        <div>
          <p className="form-error" role="alert">
            {error}
          </p>
          <button
            type="button"
            className="button secondary"
            onClick={() => {
              setError("");
              setRevision((value) => value + 1);
            }}
          >
            Thử lại
          </button>
        </div>
      ) : payment ? (
        <PaymentQr {...payment} title="Quét mã để gửi một lời thương." />
      ) : (
        <p role="status">Đang chuẩn bị QR thanh toán…</p>
      )}
    </dialog>
  );
}
