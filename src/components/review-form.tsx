"use client";
import { useEffect, useState, type FormEvent } from "react";
import { Check, Send, Star } from "lucide-react";
import type { BuyerReview } from "@/lib/order-reviews";
import { humanDate } from "@/lib/time";
import { request } from "./shop-provider";
import "./order-reviews.css";

export function ReviewStars({ rating }: { rating: number }) {
  return (
    <span className="review-stars" aria-label={`${rating} trên 5 sao`}>
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          size={16}
          aria-hidden="true"
          fill={star <= rating ? "currentColor" : "none"}
        />
      ))}
    </span>
  );
}
export function ReviewForm({
  orderId,
  productId,
  initialReview,
  onSubmitted,
}: {
  orderId: string;
  productId: string;
  initialReview?: BuyerReview | null;
  onSubmitted?: (review: BuyerReview) => void;
}) {
  const [review, setReview] = useState(initialReview ?? null),
    [rating, setRating] = useState(5),
    [text, setText] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (initialReview) setReview(initialReview);
  }, [initialReview]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await request<BuyerReview>(
        `orders/${encodeURIComponent(orderId)}/reviews`,
        { productId, rating, body: text },
      );
      setReview(result);
      onSubmitted?.(result);
      window.dispatchEvent(new Event("fleurious:reviews-updated"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (review)
    return (
      <div className="buyer-review" role="status">
        <div className="buyer-review-heading">
          <ReviewStars rating={review.rating} />
          <span className="status-tag">
            <Check size={12} aria-hidden="true" />
            {review.status === "APPROVED"
              ? "Đã hiển thị"
              : review.status === "REJECTED"
                ? "Chưa được công khai"
                : "Chờ duyệt"}
          </span>
        </div>
        <p className="preserve-lines">{review.body}</p>
        <small>{humanDate(review.createdAt)}</small>
        <p className="small muted">
          {review.status === "PENDING"
            ? "Cảm ơn lời nhắn của bạn! Đánh giá sẽ hiển thị tại trang sản phẩm sau khi cửa hàng duyệt."
            : review.status === "APPROVED"
              ? "Lời nhắn của bạn đã xuất hiện tại trang sản phẩm."
              : "Cửa hàng chưa công khai lời nhắn này. Liên hệ Fleurious nếu bạn cần hỗ trợ."}
        </p>
      </div>
    );
  return (
    <form className="review-form" onSubmit={submit}>
      <fieldset className="review-rating" disabled={busy}>
        <legend>Bó hoa đã mang đến cho bạn cảm xúc gì?</legend>
        <div>
          {[1, 2, 3, 4, 5].map((score) => (
            <label
              key={score}
              className={`review-star-choice ${score <= rating ? "selected" : ""}`}
            >
              <input
                type="radio"
                name="rating"
                value={score}
                checked={rating === score}
                onChange={() => setRating(score)}
                aria-label={`${score} sao`}
              />
              <Star
                size={24}
                fill={score <= rating ? "currentColor" : "none"}
                aria-hidden="true"
              />
            </label>
          ))}
          <span>{rating}/5</span>
        </div>
      </fieldset>
      <label>
        Lời nhắn của bạn
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          minLength={10}
          maxLength={2000}
          rows={3}
          placeholder="Chia sẻ cảm nhận về bó hoa và trải nghiệm nhận hoa…"
          required
          disabled={busy}
        />
      </label>
      <p className="review-privacy">
        Tên người mua và lời nhắn sẽ được hiển thị công khai sau khi duyệt.
        Không ghi số điện thoại, địa chỉ hay thông tin riêng tư.
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button className="button glass-primary" disabled={busy}>
        {busy ? "Đang gửi…" : "Gửi đánh giá"}
        <Send size={15} aria-hidden="true" />
      </button>
    </form>
  );
}
