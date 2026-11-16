import { money } from "@/lib/time";
import type { ShippingQuoteView, ShippingSnapshot } from "@/lib/shipping-types";
import "./ui/address-autocomplete.css";
export function ShippingSummary({
  quote,
  snapshot,
  checking,
  error,
  onRetry,
}: {
  quote?: ShippingQuoteView | null;
  snapshot?: ShippingSnapshot | null;
  checking?: boolean;
  error?: string;
  onRetry?: () => void;
}) {
  const data = quote ?? snapshot;
  return (
    <div className="shipping-preview" aria-live="polite" aria-busy={checking}>
      {error ? (
        <>
          <p className="form-error" role="alert">
            {error}
          </p>
          {onRetry && (
            <button type="button" className="text-link" onClick={onRetry}>
              Thử tính phí lại
            </button>
          )}
        </>
      ) : checking ? (
        <p>Đang tính quãng đường và phí giao…</p>
      ) : data ? (
        <>
          {snapshot?.origin && (
            <p>
              <small>Từ: {snapshot.origin.address}</small>
            </p>
          )}
          {snapshot?.destination && (
            <p>
              <small>Đến: {snapshot.destination.address}</small>
            </p>
          )}
          {data.distanceMeters !== null && (
            <div>
              <span>Quãng đường dự kiến</span>
              <span>
                Khoảng{" "}
                {(data.distanceMeters / 1000).toLocaleString("vi-VN", {
                  maximumFractionDigits: 2,
                })}{" "}
                km
              </span>
            </div>
          )}
          {data.ratePerKm !== null && (
            <div>
              <span>Đơn giá</span>
              <span>{money(data.ratePerKm)}/km</span>
            </div>
          )}
          <div>
            <span>Phí giao hoa</span>
            <strong>{money(data.fee)}</strong>
          </div>
          {snapshot?.method === "MANUAL" && (
            <small>
              Phí theo thỏa thuận · {snapshot.reason}
              {snapshot.automaticReference
                ? ` · Phí tự động tham khảo: ${money(snapshot.automaticReference.fee)}`
                : ""}
            </small>
          )}
        </>
      ) : (
        <p>Chọn địa điểm từ gợi ý để tính phí giao.</p>
      )}
    </div>
  );
}
