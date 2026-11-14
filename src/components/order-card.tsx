"use client";
import { useEffect, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import {
  CARD_DPI,
  CARD_SIZES,
  cardWritingLabels,
  type CardWritingMode,
} from "@/lib/card-design";
import { request } from "./shop-provider";
import { humanDate } from "@/lib/time";
type CardMeta = {
  state: string;
  printable: boolean;
  remaining: number;
  expiresAt: string | null;
  localUrl: boolean;
  longMessage: boolean;
  writingMode: CardWritingMode;
};
export function OrderCard({ id }: { id: string }) {
  const [meta, setMeta] = useState<CardMeta | null>(null),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    const load = () =>
      request<CardMeta>(`admin/orders/${id}/card`)
        .then((data) => {
          if (active) {
            setMeta(data);
            setError("");
          }
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    load();
    window.addEventListener("fleurious:sync", load);
    return () => {
      active = false;
      window.removeEventListener("fleurious:sync", load);
    };
  }, [id, revision]);
  const url = `/api/admin/orders/${id}/card`;
  const labels: Record<string, string> = {
    PENDING: "Chờ đơn đủ điều kiện",
    READY: "Có thể nhận ngày",
    REVOKED: "Đã thu hồi",
    EXPIRED: "Đã hết hạn",
    EXHAUSTED: "Đã hết lượt",
  };
  return (
    <section className="order-card-panel">
      <div className="order-card-heading">
        <div>
          <span className="eyebrow">CARD ĐI CÙNG BÓ HOA</span>
          <h3>Một lời thương, gửi bằng hoa.</h3>
        </div>
        <button
          type="button"
          onClick={() => setRevision((n) => n + 1)}
          aria-label="Cập nhật card giữ chuỗi"
        >
          <RefreshCw size={16} />
        </button>
      </div>
      <p>
        Thiệp lời nhắn và card QR giữ chuỗi là hai ảnh riêng. Tải ảnh để chỉnh
        sửa và in theo kích thước cần dùng.
      </p>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : !meta ? (
        <p role="status">Đang chuẩn bị card…</p>
      ) : (
        <>
          <div className="order-card-state">
            <span className="status-tag">
              {cardWritingLabels[meta.writingMode ?? "AUTO"]}
            </span>
            <span className="status-tag">{labels[meta.state]}</span>
            <span>
              {meta.remaining} lượt nhận
              {meta.expiresAt ? ` · Hạn ${humanDate(meta.expiresAt)}` : ""}
            </span>
          </div>
          {meta.printable ? (
            <>
              <div className="order-card-previews">
                {(["front", "back"] as const).map((side) => (
                  <figure key={side}>
                    <img
                      src={`${url}?format=svg&side=${side}&v=${revision}`}
                      alt={`Card Fleurious ${side === "front" ? "thiệp lời nhắn" : "mã QR giữ chuỗi khổ ngang"}`}
                      width={CARD_SIZES[side].width * 4}
                      height={CARD_SIZES[side].height * 4}
                      className={`card-image-${side}`}
                    />
                    <figcaption>
                      {side === "front"
                        ? `Thiệp ${CARD_SIZES.front.width} × ${CARD_SIZES.front.height} mm${meta.writingMode === "HANDWRITTEN" ? " · Để trống lời nhắn" : " · In lời nhắn tự động"}`
                        : `QR giữ chuỗi · ${CARD_SIZES.back.width} × ${CARD_SIZES.back.height} mm`}
                    </figcaption>
                    <div className="card-image-downloads">
                      <a
                        className="button secondary"
                        href={`${url}?format=png&side=${side}`}
                      >
                        <Download size={15} />
                        {side === "front" ? "Tải ảnh thiệp" : "Tải ảnh QR"}
                      </a>
                      <a
                        className="text-link"
                        href={`${url}?format=svg&side=${side}&download=1`}
                      >
                        Tải SVG
                      </a>
                    </div>
                  </figure>
                ))}
              </div>
              {meta.state === "PENDING" && (
                <p className="form-hint">
                  Có thể in và đóng gói trước. QR chỉ nhận được ngày khi đơn đủ
                  điều kiện; COD mở khi giao thành công.
                </p>
              )}
              {meta.localUrl && (
                <p className="form-error">
                  QR đang dùng địa chỉ nội bộ hoặc chưa có HTTPS. Cập nhật
                  APP_URL sang tên miền công khai trước khi in card gửi khách.
                </p>
              )}
              {meta.longMessage && (
                <p className="form-hint">
                  Lời nhắn dài nên cỡ chữ sẽ nhỏ hơn. Kiểm tra ảnh thiệp trước
                  khi in.
                </p>
              )}
              <p className="order-card-print-note">
                PNG {CARD_DPI} dpi; SVG là ảnh vector để co giãn. Giữ đúng tỷ lệ
                khi chỉnh kích thước và kiểm tra QR quét được trước khi in. Card
                không in số tiền, số điện thoại hoặc địa chỉ.
              </p>
            </>
          ) : (
            <p>Không in card có QR đã thu hồi, hết hạn hoặc hết lượt.</p>
          )}
        </>
      )}
    </section>
  );
}
