"use client";
import { useEffect, useId, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import { request } from "./shop-provider";
import { money } from "@/lib/time";

export function DailyPaymentConfirm({
  planId,
  version,
  invoice,
  onConfirmed,
}: {
  planId: string;
  version: number;
  invoice: { id: string; code: string; amount: number; kind: string };
  onConfirmed: (alreadyPaid: boolean) => Promise<void>;
}) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null),
    titleId = useId();
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
  }, [open]);
  const close = () => {
    if (!busy) {
      dialog.current?.close();
      setOpen(false);
    }
  };
  return (
    <>
      <div className="daily-payment-confirm-actions">
        <button
          type="button"
          className="button glass-primary"
          onClick={() => {
            setError("");
            setOpen(true);
          }}
        >
          <Check size={17} />
          Xác nhận đã thanh toán
        </button>
        <p className="small muted">
          Dùng khi cửa hàng đã kiểm tra và nhận đủ tiền của hóa đơn này.
        </p>
      </div>
      {open && (
        <dialog
          ref={dialog}
          className="admin-modal daily-payment-modal"
          aria-labelledby={titleId}
          onClose={() => setOpen(false)}
          onCancel={(e) => {
            e.preventDefault();
            close();
          }}
        >
          <div className="modal-heading">
            <h2 id={titleId}>Xác nhận đã thanh toán</h2>
            <button
              type="button"
              aria-label="Đóng xác nhận thanh toán"
              disabled={busy}
              onClick={close}
            >
              <X size={20} />
            </button>
          </div>
          <form
            className="form-stack"
            onSubmit={async (e) => {
              e.preventDefault();
              if (busy) return;
              const form = new FormData(e.currentTarget);
              setBusy(true);
              setError("");
              try {
                const result = await request<{
                  success: boolean;
                  alreadyPaid: boolean;
                }>(
                  `admin/daily/${planId}/invoices/${invoice.id}/confirm-payment`,
                  {
                    version,
                    reference: form.get("reference"),
                    reason: form.get("reason"),
                  },
                );
                dialog.current?.close();
                setOpen(false);
                await onConfirmed(result.alreadyPaid);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="daily-payment-confirm-amount">
              <span>
                {invoice.kind === "PURCHASE"
                  ? "Thanh toán gói"
                  : "Thanh toán nâng cấp mẫu"}{" "}
                · {invoice.code}
              </span>
              <strong>{money(invoice.amount)}</strong>
              <p>
                Xác nhận đã thực nhận đủ số tiền trên. Thông tin người xác nhận
                và giao dịch sẽ được lưu vào nhật ký.
              </p>
            </div>
            <label>
              Mã giao dịch ngân hàng
              <input
                name="reference"
                required
                minLength={4}
                maxLength={100}
                autoComplete="off"
                disabled={busy}
                placeholder="Mã tham chiếu trên lịch sử nhận tiền"
              />
            </label>
            <label>
              Ghi chú xác nhận
              <textarea
                name="reason"
                rows={3}
                required
                minLength={4}
                maxLength={300}
                disabled={busy}
                placeholder="Thông tin đã kiểm tra khi nhận tiền…"
              />
            </label>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <div className="daily-wizard-actions">
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={close}
              >
                Đóng
              </button>
              <button className="button glass-primary" disabled={busy}>
                {busy ? "Đang ghi nhận…" : "Xác nhận đã nhận đủ tiền"}
              </button>
            </div>
          </form>
        </dialog>
      )}
    </>
  );
}
