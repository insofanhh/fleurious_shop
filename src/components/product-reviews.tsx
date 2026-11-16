"use client";
import { useEffect, useState } from "react";
import { BadgeCheck } from "lucide-react";
import { Select } from "./ui/select";
import { request, useShop } from "./shop-provider";
import { ReviewForm, ReviewStars } from "./review-form";
import { isDeliveredOrder } from "@/lib/order-workflow";
import { humanDate } from "@/lib/time";
import type { Product } from "@/lib/types";
import type { BuyerReview, PublicReviews } from "@/lib/order-reviews";
import "./order-reviews.css";
type OwnReview = BuyerReview & { orderId: string };
export function ProductReviews({ product }: { product: Product }) {
  const { me, user } = useShop();
  const [data, setData] = useState<PublicReviews>({
      total: 0,
      average: 0,
      reviews: [],
    }),
    [own, setOwn] = useState<OwnReview[]>([]),
    [ownLoading, setOwnLoading] = useState(true),
    [ownError, setOwnError] = useState(""),
    [selected, setSelected] = useState(""),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    let alive = true,
      epoch = 0;
    const load = async () => {
      const current = ++epoch;
      try {
        const result = await request<PublicReviews>(
          `reviews?productId=${encodeURIComponent(product.id)}`,
        );
        if (alive && current === epoch) {
          setData(result);
          setError("");
          setLoading(false);
        }
      } catch (e) {
        if (alive && current === epoch) {
          setError((e as Error).message);
          setLoading(false);
        }
      }
    };
    const update = () => {
      if (document.visibilityState === "visible") void load();
    };
    void load();
    const timer = setInterval(update, 30000);
    window.addEventListener("focus", update);
    window.addEventListener("fleurious:sync", update);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener("focus", update);
      window.removeEventListener("fleurious:sync", update);
    };
  }, [product.id, revision]);
  useEffect(() => {
    setOwn([]);
    if (!user) return;
    let alive = true,
      epoch = 0;
    setOwnLoading(true);
    const load = async () => {
      const current = ++epoch;
      try {
        const result = await request<OwnReview[]>(
          `me/reviews?productId=${encodeURIComponent(product.id)}`,
        );
        if (alive && epoch === current) {
          setOwn(result);
          setOwnError("");
          setOwnLoading(false);
        }
      } catch (e) {
        if (alive && epoch === current) {
          setOwnError((e as Error).message);
          setOwnLoading(false);
        }
      }
    };
    const update = () => {
      if (document.visibilityState === "visible") void load();
    };
    void load();
    window.addEventListener("focus", update);
    window.addEventListener("fleurious:sync", update);
    window.addEventListener("fleurious:reviews-updated", update);
    return () => {
      alive = false;
      window.removeEventListener("focus", update);
      window.removeEventListener("fleurious:sync", update);
      window.removeEventListener("fleurious:reviews-updated", update);
    };
  }, [product.id, user?.id, revision]);
  const eligible =
    me?.orders.filter(
      (order) =>
        isDeliveredOrder(order) &&
        order.items.some((item) =>
          product.variants.some((variant) => variant.id === item.variantId),
        ),
    ) ?? [];
  const order =
    eligible.find((order) => order.id === selected) ??
    eligible.find(
      (order) => !own.some((review) => review.orderId === order.id),
    ) ??
    eligible[0];
  const ownReview = own.find((review) => review.orderId === order?.id);
  return (
    <section className="section product-reviews" id="product-reviews">
      <div className="section-heading product-reviews-heading">
        <h2>
          Những lời thương <em>được gửi lại.</em>
        </h2>
        <div className="product-reviews-summary">
          {data.total > 0 && (
            <>
              <strong>{data.average.toFixed(1)}/5</strong>
              <ReviewStars rating={Math.round(data.average)} />
            </>
          )}
          <span className="muted">{data.total} đánh giá từ đơn đã giao</span>
        </div>
      </div>
      {error ? (
        <div>
          <p className="form-error" role="alert">
            {error}
          </p>
          <button
            className="text-link"
            onClick={() => {
              setLoading(true);
              setError("");
              setRevision((value) => value + 1);
            }}
          >
            Tải lại đánh giá
          </button>
        </div>
      ) : loading ? (
        <p role="status">Đang mở những lời thương…</p>
      ) : data.reviews.length ? (
        <div className="product-review-list">
          {data.reviews.map((review) => (
            <article className="product-review-card" key={review.id}>
              <header>
                <strong>{review.authorName}</strong>
                <time dateTime={review.createdAt}>
                  {humanDate(review.createdAt)}
                </time>
              </header>
              <ReviewStars rating={review.rating} />
              <span className="review-purchase-badge">
                <BadgeCheck size={14} aria-hidden="true" />
                Đã mua và nhận hoa
              </span>
              <p className="preserve-lines">{review.body}</p>
              <div className="review-product-heading">
                <img
                  src={review.product.image}
                  alt={review.product.name}
                  width={42}
                  height={50}
                />
                <div>
                  <h3>{review.product.name}</h3>
                  <p>{review.product.variants.join(" · ")}</p>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="muted">
          Chưa có lời nhắn nào. Mỗi trải nghiệm của bạn đều được nâng niu.
        </p>
      )}
      {order && (
        <div className="product-review-composer">
          <h3>{ownReview ? "Đánh giá của bạn." : "Gửi lại một lời thương."}</h3>
          <label>
            Đơn hoa đã nhận
            <Select
              aria-label="Đơn hoa đã nhận"
              value={order.id}
              onChange={(event) => setSelected(event.target.value)}
            >
              {eligible.map((order) => (
                <option key={order.id} value={order.id}>
                  {order.code}
                  {own.some((review) => review.orderId === order.id)
                    ? " · Đã đánh giá"
                    : ""}
                </option>
              ))}
            </Select>
          </label>
          {ownLoading ? (
            <p role="status">Đang kiểm tra đánh giá của bạn…</p>
          ) : ownError ? (
            <div>
              <p className="form-error" role="alert">
                {ownError}
              </p>
              <button
                className="button secondary"
                onClick={() => setRevision((value) => value + 1)}
              >
                Thử lại
              </button>
            </div>
          ) : (
            <ReviewForm
              key={`${order.id}:${product.id}`}
              orderId={order.id}
              productId={product.id}
              initialReview={ownReview}
              onSubmitted={(review) => {
                setSelected(order.id);
                setOwn((value) => [
                  ...value.filter((item) => item.orderId !== order.id),
                  { ...review, orderId: order.id },
                ]);
              }}
            />
          )}
        </div>
      )}
    </section>
  );
}
