import { z } from "zod";
import { db } from "./db";
import { atomic, type Tx } from "./transaction";
import { can } from "./auth-policy";
import { fail } from "./errors";
import { catalogueSlug, type TaxonomyKind } from "./catalogue";

type Actor = { id: string; role: string };
function requireCatalog(actor: Actor) {
  if (!can(actor.role, "products"))
    fail("FORBIDDEN", "Không có quyền quản lý sản phẩm.", 403);
}
const imageSchema = z
  .string()
  .max(2048)
  .refine(
    (v) =>
      !v ||
      v.startsWith("/images/") ||
      v.startsWith("/media/") ||
      /^https:\/\//.test(v),
    "Chọn ảnh đã tải lên hoặc đường dẫn ảnh HTTPS.",
  );
export const productSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    slug: z
      .string()
      .trim()
      .max(150)
      .regex(
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
        "Slug chỉ gồm chữ thường không dấu, số và dấu gạch ngang.",
      ),
    subtitle: z.string().max(200),
    description: z.string().max(5000),
    category: z.string().trim().min(1).max(100),
    occasion: z.string().trim().min(1).max(100),
    color: z.string().trim().min(1).max(100),
    image: imageSchema.refine(Boolean, "Cần chọn ảnh sản phẩm."),
    badge: z.string().max(30).default(""),
    active: z.boolean(),
    featured: z.boolean(),
    variants: z
      .array(
        z.object({
          id: z.string().optional(),
          name: z.string().trim().min(1).max(100),
          sku: z.string().trim().min(1).max(100),
          price: z.number().int().min(1000).max(100000000),
          stock: z.number().int().min(0),
        }),
      )
      .min(1)
      .max(10),
  })
  .superRefine((value, ctx) => {
    for (const field of ["name", "sku"] as const)
      if (
        new Set(value.variants.map((v) => v[field].toLocaleLowerCase("vi")))
          .size !== value.variants.length
      )
        ctx.addIssue({
          code: "custom",
          message:
            field === "name"
              ? "Mỗi sản phẩm chỉ có một biến thể cho mỗi size."
              : "SKU của các size phải khác nhau.",
          path: ["variants"],
        });
  });
export const taxonomySchema = z.object({
  kind: z.enum(["CATEGORY", "SIZE", "OCCASION", "COLOR", "COLLECTION"]),
  name: z.string().trim().min(1).max(100),
  slug: z
    .string()
    .trim()
    .max(150)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  description: z.string().max(3000).default(""),
  image: imageSchema.default(""),
  productIds: z.array(z.string()).max(100).default([]),
  active: z.boolean().default(true),
});
async function changed(tx: Tx) {
  await tx.outbox.create({ data: { event: "catalog.changed", payload: {} } });
}
async function ensureNamed(
  tx: Tx,
  kind: TaxonomyKind,
  name: string,
  unchanged = false,
) {
  const existing = await tx.taxonomy.findFirst({ where: { kind, name } });
  if (existing) {
    if (!existing.active && !unchanged)
      fail(
        "INACTIVE_TAXONOMY",
        `${name} đang ẩn. Hãy bật lại trong Danh mục & size.`,
      );
    return;
  }
  const slug = `${kind.toLowerCase()}-${catalogueSlug(name) || "moi"}`;
  await tx.taxonomy.create({
    data: { kind, name, slug, description: "", productIds: [] },
  });
}
export async function saveCatalogProduct(
  actor: Actor,
  id: string | undefined,
  value: unknown,
) {
  requireCatalog(actor);
  const input = productSchema.parse(value);
  return atomic(async (tx) => {
    const old = id
      ? await tx.product.findUniqueOrThrow({
          where: { id },
          include: { variants: true },
        })
      : null;
    const duplicate = await tx.product.findUnique({
      where: { slug: input.slug },
    });
    if (duplicate && duplicate.id !== id)
      fail(
        "DUPLICATE_SLUG",
        "Slug đã được sản phẩm khác sử dụng. Hãy chỉnh lại slug.",
        409,
      );
    for (const [kind, field] of [
      ["CATEGORY", "category"],
      ["OCCASION", "occasion"],
      ["COLOR", "color"],
    ] as const)
      await ensureNamed(tx, kind, input[field], old?.[field] === input[field]);
    for (const variant of input.variants) {
      if (variant.id)
        await tx.$queryRaw`SELECT id FROM ProductVariant WHERE id = ${variant.id} FOR UPDATE`;
      const prior = variant.id
        ? await tx.productVariant.findUnique({ where: { id: variant.id } })
        : null;
      if (
        variant.id &&
        (!prior ||
          prior.productId !== old?.id ||
          variant.stock < prior.reserved)
      )
        fail(
          "INVALID_STOCK",
          "Tồn kho không được thấp hơn số đang giữ; size phải thuộc sản phẩm này.",
        );
      await ensureNamed(tx, "SIZE", variant.name, prior?.name === variant.name);
    }
    const { variants, ...data } = input;
    const images = [
      data.image,
      ...(Array.isArray(old?.images)
        ? old.images.filter(
            (v): v is string => typeof v === "string" && v !== data.image,
          )
        : []),
    ];
    const product = old
      ? await tx.product.update({
          where: { id: old.id },
          data: { ...data, images },
        })
      : await tx.product.create({ data: { ...data, images } });
    for (const variant of variants) {
      const { id: variantId, ...details } = variant;
      if (variantId)
        await tx.productVariant.update({
          where: { id: variantId },
          data: details,
        });
      else
        await tx.productVariant.create({
          data: { ...details, productId: product.id },
        });
    }
    await tx.audit.create({
      data: {
        actorId: actor.id,
        action: "product.save",
        entityId: product.id,
        detail: { name: product.name },
      },
    });
    await changed(tx);
    return product;
  });
}
export async function setProductVisibility(
  actor: Actor,
  id: string,
  value: unknown,
) {
  requireCatalog(actor);
  const { active } = z.object({ active: z.boolean() }).strict().parse(value);
  return atomic(async (tx) => {
    const product = await tx.product.update({
      where: { id },
      data: { active },
    });
    await tx.audit.create({
      data: {
        actorId: actor.id,
        action: "product.visibility",
        entityId: id,
        detail: { active },
      },
    });
    await changed(tx);
    return { id: product.id, active: product.active };
  });
}
export async function saveCatalogTaxonomy(
  actor: Actor,
  id: string | undefined,
  value: unknown,
) {
  requireCatalog(actor);
  const input = taxonomySchema.parse(value);
  if (input.kind !== "COLLECTION") input.productIds = [];
  return atomic(async (tx) => {
    const old = id
      ? await tx.taxonomy.findUniqueOrThrow({ where: { id } })
      : null;
    if (old && old.kind !== input.kind)
      fail("INVALID_KIND", "Tạo mục mới để đổi loại phân nhóm.");
    const same = await tx.taxonomy.findFirst({
      where: {
        kind: input.kind,
        name: input.name,
        ...(id ? { id: { not: id } } : {}),
      },
    });
    if (same) {
      if (!id && same.active) return same;
      fail(
        "DUPLICATE_NAME",
        "Tên này đã có trong cùng nhóm. Hãy chọn mục đã có hoặc bật lại mục đang ẩn.",
        409,
      );
    }
    if (old && old.name !== input.name) {
      if (old.kind === "SIZE") {
        const assigned = await tx.productVariant.findMany({
          where: { name: old.name },
          select: { productId: true },
        });
        if (
          await tx.productVariant.count({
            where: {
              name: input.name,
              productId: { in: assigned.map((v) => v.productId) },
            },
          })
        )
          fail(
            "DUPLICATE_SIZE",
            "Có sản phẩm đã có size trùng tên mới. Hãy chọn tên size khác.",
          );
        await tx.productVariant.updateMany({
          where: { name: old.name },
          data: { name: input.name },
        });
      } else if (["CATEGORY", "OCCASION", "COLOR"].includes(old.kind)) {
        const field =
          old.kind === "CATEGORY"
            ? "category"
            : old.kind === "OCCASION"
              ? "occasion"
              : "color";
        await tx.product.updateMany({
          where: { [field]: old.name },
          data: { [field]: input.name },
        });
      }
    }
    const entity = old
      ? await tx.taxonomy.update({ where: { id: old.id }, data: input })
      : await tx.taxonomy.create({ data: input });
    await tx.audit.create({
      data: {
        actorId: actor.id,
        action: "taxonomy.save",
        entityId: entity.id,
        detail: input,
      },
    });
    await changed(tx);
    return entity;
  });
}
export async function hideCatalogTaxonomy(actor: Actor, id: string) {
  requireCatalog(actor);
  await atomic(async (tx) => {
    await tx.taxonomy.update({ where: { id }, data: { active: false } });
    await tx.audit.create({
      data: {
        actorId: actor.id,
        action: "taxonomy.hide",
        entityId: id,
        detail: {},
      },
    });
    await changed(tx);
  });
}
