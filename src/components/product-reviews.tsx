"use client";
import { Select } from "./ui/select";
import { useEffect, useState } from "react";
import { Star } from "lucide-react";
import { request, useShop } from "./shop-provider";
import type { Product } from "@/lib/types";
export function ProductReviews({ product }: { product: Product }) {
  const { me, toast } = useShop();
  const [reviews, setReviews] = useState<
      { id: string; authorName: string; rating: number; body: string }[]
    >([]),
    [sent, setSent] = useState(false);
  useEffect(() => {
    request<typeof reviews>(`reviews?productId=${product.id}`)
      .then(setReviews)
      .catch(() => {});
  }, [product.id]);
  const eligible =
    me?.orders.filter(
      (o) =>
        o.status === "COMPLETED" &&
        o.items.some((i) => product.variants.some((v) => v.id === i.variantId)),
    ) ?? [];
  return (
    <section className="section">
      <div className="section-heading">
        <h2>
          Những lời thương <em>được gửi lại.</em>
        </h2>
        <span className="small muted">
          {reviews.length} đánh giá từ đơn đã giao
        </span>
      </div>
      {reviews.length ? (
        reviews.map((r) => (
          <article
            className="admin-panel"
            style={{ marginBottom: 15 }}
            key={r.id}
          >
            <div
              style={{
                display: "flex",
                gap: 4,
                color: "#6e1423",
                marginBottom: 12,
              }}
            >
              {Array.from({ length: r.rating }, (_, i) => (
                <Star size={14} fill="currentColor" key={i} />
              ))}
            </div>
            <strong>{r.authorName}</strong>
            <p
              className="preserve-lines"
              style={{ marginTop: 12, fontSize: 12 }}
            >
              {r.body}
            </p>
          </article>
        ))
      ) : (
        <p className="muted">
          Chưa có lời nhắn nào. Mỗi trải nghiệm của bạn đều được nâng niu.
        </p>
      )}
      {eligible.length > 0 && !sent && (
        <form
          className="form-stack narrow-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            try {
              await request("me/reviews", {
                productId: product.id,
                orderId: data.get("orderId"),
                rating: Number(data.get("rating")),
                body: data.get("body"),
              });
              setSent(true);
              toast(
                "Cảm ơn lời nhắn của bạn! Đánh giá đang chờ cửa hàng duyệt.",
              );
            } catch (e) {
              toast((e as Error).message);
            }
          }}
        >
          <h3>Gửi lại một lời thương.</h3>
          <label>
            Đơn hoa
            <Select name="orderId">
              {eligible.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.code}
                </option>
              ))}
            </Select>
          </label>
          <label>
            Trải nghiệm của bạn
            <Select name="rating" defaultValue="5">
              {[5, 4, 3, 2, 1].map((r) => (
                <option key={r} value={r}>
                  {r} sao
                </option>
              ))}
            </Select>
          </label>
          <label>
            Lời nhắn
            <textarea
              name="body"
              minLength={10}
              maxLength={2000}
              required
              rows={3}
            />
          </label>
          <p className="small muted">
            Tên và lời nhắn của bạn sẽ hiển thị công khai sau khi duyệt. Không
            ghi số điện thoại, địa chỉ hay thông tin riêng tư.
          </p>
          <button className="button">Gửi đánh giá</button>
        </form>
      )}
    </section>
  );
}
