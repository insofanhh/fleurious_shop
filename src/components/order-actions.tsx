"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { RotateCcw, Star, X, ArrowUpRight } from "lucide-react";
import { isOrderExpired } from "@/lib/order-expiry";
import { isDeliveredOrder } from "@/lib/order-workflow";
import type { Order } from "@/lib/types";
import type { BuyerReview, OrderReviewData } from "@/lib/order-reviews";
import { request } from "./shop-provider";
import { ReviewForm } from "./review-form";
import "./order-reviews.css";

export function OrderActions({ order }: { order: Order }) {
  const [open, setOpen] = useState(false),
    [reviewed, setReviewed] = useState(false);
  const delivered = isDeliveredOrder(order),
    canReorder = isOrderExpired(order) || delivered;
  const loaded = useCallback(
    (data: OrderReviewData) =>
      setReviewed(
        data.products.length > 0 && data.products.every((p) => !!p.review),
      ),
    [],
  );
  if (!canReorder && !delivered) return null;
  return (
    <div className="order-actions">
      {canReorder && (
        <Link
          className="button secondary"
          href={`/checkout?reorder=${order.id}`}
        >
          <RotateCcw size={15} aria-hidden="true" />
          Đặt lại
        </Link>
      )}
      {delivered && (
        <button
          type="button"
          className="button glass-primary"
          onClick={() => setOpen(true)}
        >
          <Star size={15} aria-hidden="true" />
          {reviewed ? "Xem đánh giá" : "Đánh giá"}
        </button>
      )}
      {open && (
        <OrderReviewDialog
          orderId={order.id}
          onClose={() => setOpen(false)}
          onLoaded={loaded}
        />
      )}
    </div>
  );
}
function OrderReviewDialog({
  orderId,
  onClose,
  onLoaded,
}: {
  orderId: string;
  onClose: () => void;
  onLoaded: (data: OrderReviewData) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [data, setData] = useState<OrderReviewData | null>(null),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    const element = dialog.current!,
      previous = document.activeElement as HTMLElement | null,
      overflow = document.body.style.overflow;
    element.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      element.close();
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);
  useEffect(() => {
    let alive = true;
    request<OrderReviewData>(`orders/${encodeURIComponent(orderId)}/reviews`)
      .then((result) => {
        if (alive) {
          setData(result);
          setError("");
          onLoaded(result);
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [orderId, revision, onLoaded]);
  function submitted(productId: string, review: BuyerReview) {
    if (!data) return;
    const next = {
      ...data,
      products: data.products.map((p) =>
        p.id === productId ? { ...p, review } : p,
      ),
    };
    setData(next);
    onLoaded(next);
  }
  return (
    <dialog
      ref={dialog}
      className="order-review-dialog"
      aria-labelledby="order-review-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header className="order-review-dialog-heading">
        <div>
          <span className="eyebrow">
            {data?.code ?? "LỜI THƯƠNG SAU GIAO HOA"}
          </span>
          <h2 id="order-review-title">Một bó hoa, một cảm nhận.</h2>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Đóng đánh giá"
          onClick={onClose}
          autoFocus
        >
          <X size={20} />
        </button>
      </header>
      {error ? (
        <div>
          <p className="form-error" role="alert">
            {error}
          </p>
          <button
            className="button secondary"
            onClick={() => {
              setError("");
              setRevision((value) => value + 1);
            }}
          >
            Thử lại
          </button>
        </div>
      ) : !data ? (
        <p role="status">Đang mở những bó hoa bạn đã nhận…</p>
      ) : (
        <>
          {!data.canReview && (
            <p className="notice">
              Chỉ có thể gửi đánh giá khi đơn đã giao thành công.
            </p>
          )}
          {data.products.map((product) => (
            <article className="order-review-product" key={product.id}>
              <div className="review-product-heading">
                <img
                  src={product.image}
                  alt={product.name}
                  width={60}
                  height={72}
                />
                <div>
                  <h3>{product.name}</h3>
                  <p>{product.variants.join(" · ")}</p>
                  {product.slug && (
                    <Link
                      className="text-link"
                      href={`/flowers/${product.slug}`}
                      onClick={onClose}
                    >
                      Xem sản phẩm
                      <ArrowUpRight size={13} />
                    </Link>
                  )}
                </div>
              </div>
              {(data.canReview || product.review) && (
                <ReviewForm
                  orderId={orderId}
                  productId={product.id}
                  initialReview={product.review}
                  onSubmitted={(review) => submitted(product.id, review)}
                />
              )}
            </article>
          ))}
          {!data.products.length && (
            <p>
              Thông tin sản phẩm này không còn khả dụng. Vui lòng liên hệ
              Fleurious để gửi phản hồi.
            </p>
          )}
        </>
      )}
    </dialog>
  );
}
