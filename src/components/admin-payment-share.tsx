"use client";
import { useEffect, useState } from "react";
import { Download, Check } from "lucide-react";
import Link from "next/link";
import { PaymentQr } from "./payment-qr";
import { request } from "./shop-provider";
import { CopyButton } from "./copy-button";
import { useDeadline } from "./use-deadline";

type Data = {
  code: string;
  amount: number;
  url: string | null;
  deadline: string | null;
  bank: string;
  accountName: string;
  accountNumber: string;
  paymentStatus: string;
  overdue: boolean;
  serverNow: string;
  version: number;
  canEditTerms: boolean;
};
export function AdminPaymentShare({ orderId }: { orderId: string }) {
  const [data, setData] = useState<Data | null>(null),
    [error, setError] = useState("");
  const [revision, setRevision] = useState(0),
    [savingTerms, setSavingTerms] = useState(false),
    [termsError, setTermsError] = useState("");
  const [noLimit, setNoLimit] = useState(false);
  const seconds = useDeadline(data?.deadline ?? undefined, data?.serverNow);
  useEffect(() => {
    let alive = true,
      current = 0;
    const load = async () => {
      const id = ++current;
      try {
        const result = await request<Data>(
          `admin/orders/${orderId}/payment-qr`,
        );
        if (alive && current === id) {
          setData(result);
          setError("");
        }
      } catch (e) {
        if (alive && current === id) setError((e as Error).message);
      }
    };
    void load();
    window.addEventListener("fleurious:sync", load);
    return () => {
      alive = false;
      window.removeEventListener("fleurious:sync", load);
    };
  }, [orderId, revision]);
  if (error)
    return (
      <p className="form-error" role="alert">
        {error}
      </p>
    );
  if (!data) return <p role="status">Đang chuẩn bị QR chuyển khoản…</p>;
  const trackingPath = `/track-order?code=${encodeURIComponent(data.code)}`;
  const trackingLink =
    typeof window === "undefined"
      ? trackingPath
      : new URL(trackingPath, window.location.origin).href;
  return (
    <section className="admin-payment-share">
      <p className="order-code-with-copy">
        <strong>{data.code}</strong>
        <CopyButton value={data.code} />
      </p>
      <div className="admin-payment-share-actions">
        {data.url && !data.overdue && seconds !== 0 && (
          <a
            className="button secondary"
            href={`/api/admin/orders/${orderId}/payment-qr?download=1`}
            download={`fleurious-payment-${data.code}.png`}
          >
            <Download size={16} />
            Tải ảnh QR
          </a>
        )}
        <Link href={trackingPath} target="_blank" rel="noopener noreferrer">
          Mở trang khách tra cứu
        </Link>
        <CopyButton value={trackingLink} label="link tra cứu" />
      </div>
      {["PAID", "PARTIALLY_REFUNDED", "REFUNDED"].includes(
        data.paymentStatus,
      ) ? (
        <p className="admin-notice" role="status">
          <Check size={18} /> Đơn đã được xác nhận thanh toán.
        </p>
      ) : data.overdue || seconds === 0 ? (
        <p className="admin-notice">
          Đã quá hạn thanh toán. Không tiếp tục gửi QR cũ. Nếu khách đã chuyển
          tiền, kiểm tra giao dịch và xác nhận thủ công tại chi tiết đơn.
        </p>
      ) : data.url ? (
        <PaymentQr
          url={data.url}
          amount={data.amount}
          code={data.code}
          bank={data.bank}
          accountName={data.accountName}
          accountNumber={data.accountNumber}
          expiresAt={data.deadline ?? undefined}
          serverNow={data.serverNow}
          title=""
        />
      ) : (
        <p className="admin-notice">
          QR không khả dụng. Kiểm tra trạng thái đơn và cấu hình ngân hàng.
        </p>
      )}

      <p className="small muted">
        Gửi ảnh QR kèm mã đơn hoặc link tra cứu cho khách. Khách chuyển đúng số
        tiền và nội dung; hệ thống cập nhật khi SePay xác nhận.
      </p>
      {data.canEditTerms && (
        <details className="detail-disclosure">
          <summary>Đổi / gia hạn thanh toán</summary>
          <form
            className="form-stack"
            onSubmit={async (e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              setSavingTerms(true);
              setTermsError("");
              try {
                await request(
                  `admin/orders/${orderId}/payment-terms`,
                  {
                    version: data.version,
                    minutes: noLimit
                      ? null
                      : Math.round(Number(form.get("hours")) * 60),
                    reason: form.get("reason"),
                  },
                  "PATCH",
                );
                setRevision((v) => v + 1);
                window.dispatchEvent(new Event("fleurious:sync"));
              } catch (e) {
                setTermsError((e as Error).message);
              } finally {
                setSavingTerms(false);
              }
            }}
          >
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={noLimit}
                onChange={(e) => setNoLimit(e.target.checked)}
              />
              Không giới hạn thời gian
            </label>
            {!noLimit && (
              <label>
                Thời gian kể từ bây giờ (giờ)
                <input
                  type="number"
                  name="hours"
                  min="0.25"
                  max="720"
                  step="0.25"
                  defaultValue="24"
                  required
                />
              </label>
            )}
            <label>
              Lý do thay đổi
              <input name="reason" minLength={4} maxLength={300} required />
            </label>
            {termsError && (
              <p className="form-error" role="alert">
                {termsError}
              </p>
            )}
            <button className="button secondary" disabled={savingTerms}>
              {savingTerms ? "Đang lưu…" : "Cập nhật hạn thanh toán"}
            </button>
          </form>
        </details>
      )}
    </section>
  );
}
