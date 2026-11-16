import "dotenv/config";
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../src/lib/db";
import {
  saveCatalogProduct,
  saveCatalogTaxonomy,
  setProductVisibility,
  hideCatalogTaxonomy,
} from "../src/lib/catalog-admin";
import { catalogueSlug, taxonomyOptions } from "../src/lib/catalogue";

const run = `qa-catalog-${randomUUID()}`,
  actor = { id: run, role: "OWNER" };
const key = (name: string) => `${run}-${name}`;
const product = (suffix: string, size = key("size")) => ({
  name: key(suffix),
  slug: key(suffix),
  subtitle: "Một lời thương",
  description: "Hoa tươi",
  category: key("category"),
  occasion: key("occasion"),
  color: key("color"),
  image: "/images/roses.webp",
  active: true,
  featured: false,
  badge: "",
  variants: [
    { name: size, sku: key(`sku-${suffix}`), price: 500000, stock: 10 },
  ],
});
before(() =>
  assert.match(new URL(process.env.DATABASE_URL!).pathname, /_test$/),
);
after(async () => {
  const products = await db.product.findMany({
    where: { slug: { startsWith: run } },
    select: { id: true },
  });
  await db.productVariant.deleteMany({
    where: { productId: { in: products.map((p) => p.id) } },
  });
  await db.product.deleteMany({ where: { slug: { startsWith: run } } });
  await db.taxonomy.deleteMany({ where: { name: { startsWith: run } } });
  await db.audit.deleteMany({ where: { actorId: run } });
  await db.$disconnect();
});
test("Vietnamese names produce usable slugs and hidden taxonomy options stay unavailable", () => {
  assert.equal(
    catalogueSlug("  Bó Hoa Đỏ – Yêu & Thương!  "),
    "bo-hoa-do-yeu-thuong",
  );
  assert.equal(catalogueSlug("Hoa Đào / 2026 🌸"), "hoa-dao-2026");
  assert.equal(catalogueSlug("🌸"), "");
  const items = [
    { id: "1", kind: "SIZE", name: "S", slug: "s", active: false },
    { id: "2", kind: "SIZE", name: "M", slug: "m", active: true },
  ];
  assert.deepEqual(taxonomyOptions(items, "SIZE", ["S", "M", "L"]), ["M", "L"]);
  assert.deepEqual(taxonomyOptions(items, "SIZE", ["S", "M"], "S"), ["M", "S"]);
});
test("catalogue writes enforce roles and stock reservations without partial changes", async () => {
  await assert.rejects(
    () =>
      saveCatalogProduct(
        { id: run, role: "CUSTOMER" },
        undefined,
        product("forbidden"),
      ),
    { code: "FORBIDDEN" },
  );
  const p = await saveCatalogProduct(actor, undefined, product("stock"));
  const variant = await db.productVariant.findFirstOrThrow({
    where: { productId: p.id },
  });
  await db.productVariant.update({
    where: { id: variant.id },
    data: { reserved: 3 },
  });
  await assert.rejects(
    () =>
      saveCatalogProduct(actor, p.id, {
        ...product("stock"),
        name: "Should roll back",
        variants: [{ ...variant, stock: 2 }],
      }),
    { code: "INVALID_STOCK" },
  );
  assert.equal(
    (await db.product.findUniqueOrThrow({ where: { id: p.id } })).name,
    key("stock"),
  );
  const fresh = await db.productVariant.findUniqueOrThrow({
    where: { id: variant.id },
  });
  assert.equal(fresh.stock, 10);
  assert.equal(fresh.reserved, 3);
  assert.equal(
    await db.taxonomy.count({ where: { kind: "SIZE", name: variant.name } }),
    1,
  );
});
test("visibility switch changes only active state and publishes a catalog refresh", async () => {
  const p = await saveCatalogProduct(actor, undefined, product("visibility"));
  const oldVariants = await db.productVariant.findMany({
    where: { productId: p.id },
  });
  const events = await db.outbox.count({ where: { event: "catalog.changed" } });
  await setProductVisibility({ id: run, role: "MARKETING" }, p.id, {
    active: false,
  });
  assert.deepEqual(
    await db.product.findUniqueOrThrow({ where: { id: p.id } }),
    { ...p, active: false },
  );
  assert.deepEqual(
    await db.productVariant.findMany({ where: { productId: p.id } }),
    oldVariants,
  );
  assert.equal(
    await db.product.count({ where: { id: p.id, active: true } }),
    0,
  );
  await setProductVisibility(actor, p.id, { active: true });
  assert.equal(
    await db.product.count({ where: { id: p.id, active: true } }),
    1,
  );
  assert.equal(
    await db.outbox.count({ where: { event: "catalog.changed" } }),
    events + 2,
  );
  await assert.rejects(
    () =>
      setProductVisibility({ id: run, role: "DELIVERY" }, p.id, {
        active: true,
      }),
    { code: "FORBIDDEN" },
  );
  await assert.rejects(() =>
    setProductVisibility(actor, p.id, { active: false, price: 1 }),
  );
});
test("duplicate slugs and sizes are rejected and variant IDs cannot cross products", async () => {
  const p = await saveCatalogProduct(actor, undefined, product("first"));
  await assert.rejects(
    () => saveCatalogProduct(actor, undefined, product("first")),
    { code: "DUPLICATE_SLUG" },
  );
  const variant = await db.productVariant.findFirstOrThrow({
    where: { productId: p.id },
  });
  await assert.rejects(
    () =>
      saveCatalogProduct(actor, undefined, {
        ...product("tampered"),
        variants: [{ ...variant }],
      }),
    { code: "INVALID_STOCK" },
  );
  assert.equal(await db.product.count({ where: { slug: key("tampered") } }), 0);
  await assert.rejects(() =>
    saveCatalogProduct(actor, undefined, {
      ...product("duplicate"),
      variants: [
        product("duplicate").variants[0],
        { ...product("duplicate").variants[0], sku: key("other-sku") },
      ],
    }),
  );
});
test("shared size renaming preserves each product's prices, SKU and reserved stock", async () => {
  const name = key("shared"),
    renamed = key("shared-renamed");
  const size = await saveCatalogTaxonomy(actor, undefined, {
    kind: "SIZE",
    name,
    slug: key("size-slug"),
  });
  const a = await saveCatalogProduct(
    actor,
    undefined,
    product("rename-a", name),
  );
  const b = await saveCatalogProduct(
    actor,
    undefined,
    product("rename-b", name),
  );
  const variants = await db.productVariant.findMany({
    where: { productId: { in: [a.id, b.id] } },
    orderBy: { id: "asc" },
  });
  await saveCatalogTaxonomy(actor, size.id, {
    kind: "SIZE",
    name: renamed,
    slug: size.slug,
  });
  assert.deepEqual(
    await db.productVariant.findMany({
      where: { productId: { in: [a.id, b.id] } },
      orderBy: { id: "asc" },
    }),
    variants.map((v) => ({ ...v, name: renamed })),
  );
  await hideCatalogTaxonomy(actor, size.id);
  assert.equal(
    (await db.taxonomy.findUniqueOrThrow({ where: { id: size.id } })).active,
    false,
  );
  await assert.rejects(
    () => saveCatalogProduct(actor, undefined, product("hidden-size", renamed)),
    { code: "INACTIVE_TAXONOMY" },
  );
  const existing = await db.productVariant.findFirstOrThrow({
    where: { productId: a.id },
  });
  await saveCatalogProduct(actor, a.id, {
    ...product("rename-a", renamed),
    variants: [{ ...existing, price: 600000 }],
  });
  assert.equal(
    (await db.productVariant.findUniqueOrThrow({ where: { id: existing.id } }))
      .price,
    600000,
  );
});
test("inline taxonomy creation deduplicates, and category rename updates assigned products", async () => {
  const input = {
    kind: "CATEGORY",
    name: key("inline"),
    slug: key("inline-slug"),
  };
  const [first, second] = await Promise.all([
    saveCatalogTaxonomy(actor, undefined, input),
    saveCatalogTaxonomy(actor, undefined, input),
  ]);
  assert.equal(first.id, second.id);
  const p = await saveCatalogProduct(actor, undefined, {
    ...product("category-rename"),
    category: input.name,
  });
  const updatedName = key("category-renamed");
  await saveCatalogTaxonomy(actor, first.id, { ...input, name: updatedName });
  assert.equal(
    (await db.product.findUniqueOrThrow({ where: { id: p.id } })).category,
    updatedName,
  );
  await assert.rejects(
    () => saveCatalogTaxonomy(actor, first.id, { ...input, kind: "SIZE" }),
    { code: "INVALID_KIND" },
  );
});
