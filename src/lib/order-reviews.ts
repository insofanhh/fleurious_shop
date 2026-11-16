import { z } from "zod";
import { db } from "./db";
import { atomic } from "./transaction";
import { fail } from "./errors";
import { hash } from "./security";
import { isDeliveredOrder } from "./order-workflow";

type Buyer = { userId?: string; name?: string; guestToken?: string };
function owns(
  order: { userId: string | null; guestHash: string | null },
  buyer: Buyer,
) {
  return !!(
    (order.userId && order.userId === buyer.userId) ||
    (buyer.guestToken && order.guestHash === hash(buyer.guestToken))
  );
}
const reviewSelect = {
  id: true,
  rating: true,
  body: true,
  status: true,
  createdAt: true,
} as const;
export type BuyerReview = {
  id: string;
  rating: number;
  body: string;
  status: string;
  createdAt: string;
};
export type ReviewProduct = {
  id: string;
  name: string;
  image: string;
  slug: string | null;
  variants: string[];
  review: BuyerReview | null;
};
export type OrderReviewData = {
  code: string;
  canReview: boolean;
  products: ReviewProduct[];
};
export type PublicReviews = {
  total: number;
  average: number;
  reviews: {
    id: string;
    authorName: string;
    rating: number;
    body: string;
    createdAt: string;
    product: { name: string; image: string; variants: string[] };
  }[];
};

export async function orderReviewOptions(id: string, buyer: Buyer) {
  const order = await db.order.findUnique({
    where: { id },
    include: { items: true },
  });
  if (!order || !owns(order, buyer))
    fail("NOT_FOUND", "Không tìm thấy đơn hàng.", 404);
  const [variants, reviews] = await Promise.all([
    db.productVariant.findMany({
      where: { id: { in: order.items.map((i) => i.variantId) } },
      include: { product: { select: { id: true, slug: true, active: true } } },
    }),
    db.review.findMany({
      where: { orderId: id },
      select: { ...reviewSelect, productId: true },
    }),
  ]);
  const products = new Map<
    string,
    {
      id: string;
      name: string;
      image: string;
      slug: string | null;
      variants: string[];
      review: (typeof reviews)[number] | null;
    }
  >();
  for (const item of order.items) {
    const product = variants.find((v) => v.id === item.variantId)?.product;
    if (!product) continue;
    const existing = products.get(product.id);
    if (existing) {
      if (!existing.variants.includes(item.variantName))
        existing.variants.push(item.variantName);
    } else
      products.set(product.id, {
        id: product.id,
        name: item.name,
        image: item.image,
        slug: product.active ? product.slug : null,
        variants: [item.variantName],
        review: reviews.find((r) => r.productId === product.id) ?? null,
      });
  }
  return {
    code: order.code,
    canReview: isDeliveredOrder(order),
    products: [...products.values()].map((p) => ({
      ...p,
      review: p.review
        ? {
            id: p.review.id,
            rating: p.review.rating,
            body: p.review.body,
            status: p.review.status,
            createdAt: p.review.createdAt,
          }
        : null,
    })),
  };
}

export async function createOrderReview(
  id: string,
  raw: unknown,
  buyer: Buyer,
) {
  const input = z
    .object({
      productId: z.string().min(1).max(100),
      rating: z.number().int().min(1).max(5),
      body: z
        .string()
        .trim()
        .min(10, "Lời nhắn cần ít nhất 10 ký tự.")
        .max(2000),
    })
    .parse(raw);
  return atomic(async (tx) => {
    await tx.$queryRaw`SELECT id FROM \`Order\` WHERE id=${id} FOR UPDATE`;
    const order = await tx.order.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!order || !owns(order, buyer))
      fail("NOT_FOUND", "Không tìm thấy đơn hàng.", 404);
    if (!isDeliveredOrder(order))
      fail(
        "NOT_DELIVERED",
        "Bạn có thể đánh giá sau khi đơn đã giao thành công.",
      );
    const purchased = await tx.productVariant.findFirst({
      where: {
        productId: input.productId,
        id: { in: order.items.map((i) => i.variantId) },
      },
    });
    if (!purchased)
      fail("NOT_PURCHASED", "Sản phẩm này không thuộc đơn hoa của bạn.");
    if (
      await tx.review.findFirst({
        where: { orderId: id, productId: input.productId },
      })
    )
      fail(
        "REVIEW_EXISTS",
        "Bạn đã gửi đánh giá cho sản phẩm này trong đơn hoa.",
        409,
      );
    // A guest uses the same verified order cookie as private order details; no new identity is granted.
    const userId = order.userId ?? `guest:${order.guestHash}`;
    const review = await tx.review.create({
      data: {
        ...input,
        orderId: id,
        userId,
        authorName:
          (order.userId === buyer.userId ? buyer.name : order.buyerName) ||
          order.buyerName,
      },
      select: reviewSelect,
    });
    await tx.outbox.create({
      data: { event: "review.created", payload: { reviewId: review.id } },
    });
    return review;
  });
}

export async function buyerProductReviews(userId: string, productId: string) {
  return db.review.findMany({
    where: { userId, productId },
    select: { ...reviewSelect, orderId: true },
  });
}

/** Publish approved text and purchased flower details, never an order/customer serializer. */
export async function publicProductReviews(productId: string) {
  const [reviews, stats, product] = await Promise.all([
    db.review.findMany({
      where: { productId, status: "APPROVED" },
      select: {
        id: true,
        orderId: true,
        authorName: true,
        rating: true,
        body: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
    db.review.aggregate({
      where: { productId, status: "APPROVED" },
      _count: { id: true },
      _avg: { rating: true },
    }),
    db.product.findUnique({
      where: { id: productId },
      select: { name: true, image: true, variants: { select: { id: true } } },
    }),
  ]);
  const items = product
    ? await db.orderItem.findMany({
        where: {
          orderId: { in: reviews.map((r) => r.orderId) },
          variantId: { in: product.variants.map((v) => v.id) },
        },
        select: { orderId: true, name: true, image: true, variantName: true },
      })
    : [];
  return {
    total: stats._count.id,
    average: stats._avg.rating ?? 0,
    reviews: reviews.map(({ orderId, ...review }) => {
      const purchased = items.filter((i) => i.orderId === orderId);
      return {
        ...review,
        product: {
          name: purchased[0]?.name ?? product?.name ?? "Bó hoa",
          image: purchased[0]?.image ?? product?.image ?? "",
          variants: [...new Set(purchased.map((i) => i.variantName))],
        },
      };
    }),
  };
}
