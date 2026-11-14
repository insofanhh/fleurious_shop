"use client";
import { Download } from "lucide-react";
import { CARD_DPI, CARD_SIZES } from "@/lib/card-design";

export function CardTemplates() {
  return (
    <section className="card-template-panel" id="card-templates">
      <div className="section-heading">
        <div>
          <span className="eyebrow">FLEURIOUS · BỘ CARD THƯƠNG HIỆU</span>
          <h2>Phôi thiệp & card logo.</h2>
        </div>
      </div>
      <p>
        Phôi dùng để viết tay và card thương hiệu có sẵn để tải. PNG {CARD_DPI}{" "}
        dpi, SVG có thể co giãn để chỉnh sửa và in theo kích thước bạn muốn.
      </p>
      <div className="card-template-grid">
        {(["blank", "brand"] as const).map((kind) => {
          const size = CARD_SIZES[kind],
            url = `/api/admin/settings/card-templates?kind=${kind}`;
          return (
            <figure key={kind} className="card-template-item">
              <div className="card-template-image">
                <img
                  src={`${url}&format=svg`}
                  alt={
                    kind === "blank"
                      ? "Phôi thiệp Fleurious cùng bố cục thiệp trong đơn hàng, chừa trống tên người nhận, người gửi và lời nhắn để viết tay"
                      : "Card logo Fleurious màu kem trên nền Burgundy"
                  }
                  width={size.width * 4}
                  height={size.height * 4}
                />
              </div>
              <figcaption>
                <strong>
                  {kind === "blank"
                    ? "Phôi thiệp viết tay"
                    : "Card logo Fleurious"}
                </strong>
                <span>
                  {size.width} × {size.height} mm ·{" "}
                  {kind === "blank"
                    ? "Tên và lời nhắn viết tay"
                    : "Chỉ logo & màu thương hiệu"}
                </span>
              </figcaption>
              <div className="card-image-downloads">
                <a className="button secondary" href={`${url}&format=png`}>
                  <Download size={15} /> Tải PNG
                </a>
                <a className="text-link" href={`${url}&format=svg&download=1`}>
                  Tải SVG
                </a>
              </div>
            </figure>
          );
        })}
      </div>
    </section>
  );
}
