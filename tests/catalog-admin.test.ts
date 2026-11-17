import "dotenv/config";
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../src/lib/db";
import {
  saveCatalogProduct,
  listCatalogProducts,
  saveCatalogTaxonomy,
  setProductVisibility,
  hideCatalogTaxonomy,
} from "../src/lib/catalog-admin";
import {
  catalogueSlug,
  taxonomyOptions,
  DAILY_CATEGORY,
} from "../src/lib/catalogue";
import {
  dailyConfig,
  dailyOfferings,
  saveDailyOffering,
} from "../src/lib/daily";

const run = `qa-catalog-${randomUUID()}`,
  actor = { id: run, role: "OWNER" };
const key = (name: string) => `${run}-${name}`;
async function markDaily(productId: string) {
  const taxonomy = await db.taxonomy.findFirstOrThrow({
    where: { kind: "CATEGORY", name: DAILY_CATEGORY },
  });
  await db.productTaxonomy.create({
    data: { productId, taxonomyId: taxonomy.id },
  });
}
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
  const variants = await db.productVariant.findMany({
    where: { productId: { in: products.map((p) => p.id) } },
    select: { id: true },
  });
  await db.dailyOffering.deleteMany({
    where: { variantId: { in: variants.map((v) => v.id) } },
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

test("Daily category automatically enrolls Vừa xinh without changing retail prices", async () => {
  const config = await dailyConfig();
  const ordinary = await saveCatalogProduct(
    actor,
    undefined,
    product("ordinary-daily"),
  );
  assert.equal(
    await db.dailyOffering.count({ where: { name: ordinary.name } }),
    0,
  );
  const input = {
    ...product("daily-auto", "Vừa xinh"),
    categories: [key("category"), DAILY_CATEGORY],
  };
  const p = await saveCatalogProduct(
    { id: run, role: "MARKETING" },
    undefined,
    input,
  );
  const variant = await db.productVariant.findFirstOrThrow({
    where: { productId: p.id },
  });
  const offering = await db.dailyOffering.findUniqueOrThrow({
    where: {
      variantId_budgetCode: {
        variantId: variant.id,
        budgetCode: "catalog",
      },
    },
  });
  assert.equal(offering.name, p.name);
  assert.equal(offering.premium, 0);
  assert.equal(offering.active, true);
  assert.equal(variant.name, "Vừa xinh");
  assert.equal(variant.price, input.variants[0].price);
  assert.equal(variant.stock, input.variants[0].stock);
  assert.deepEqual(
    await dailyConfig(),
    config,
    "adding an offering must not change Daily pricing or enable sales",
  );
  await saveCatalogProduct(actor, p.id, {
    ...input,
    name: "Tên hoa mới ".repeat(10).trim(),
    variants: [variant],
  });
  const renamed = await db.dailyOffering.findUniqueOrThrow({
    where: { id: offering.id },
  });
  assert.equal(renamed.name, "Tên hoa mới ".repeat(10).trim());
  assert.equal(
    await db.dailyOffering.count({ where: { variantId: variant.id } }),
    1,
  );
});

test("Daily enrollment rejects missing sizes and rolls back the product if automatic enrollment fails", async () => {
  await assert.rejects(() =>
    saveCatalogProduct(actor, undefined, {
      ...product("daily-missing-size"),
      categories: [key("category"), DAILY_CATEGORY],
    }),
  );
  assert.equal(
    await db.product.count({ where: { slug: key("daily-missing-size") } }),
    0,
  );
  const before = await db.dailyOffering.count();
  const occupied = await saveCatalogProduct(
    actor,
    undefined,
    product("daily-taken-sku"),
  );
  const invalid = {
    ...product("daily-rollback", "Vừa xinh"),
    categories: [key("category"), DAILY_CATEGORY],
  };
  invalid.variants[0].sku = product("daily-taken-sku").variants[0].sku;
  await assert.rejects(() => saveCatalogProduct(actor, undefined, invalid));
  assert.equal(await db.product.count({ where: { slug: invalid.slug } }), 0);
  assert.equal(await db.dailyOffering.count(), before);
  assert(occupied.id);
});

test("Daily offering names follow the selected product and cannot be overridden by a submitted name", async () => {
  const a = await saveCatalogProduct(actor, undefined, product("daily-name-a"));
  const b = await saveCatalogProduct(actor, undefined, product("daily-name-b"));
  const variantA = await db.productVariant.findFirstOrThrow({
    where: { productId: a.id },
  });
  const variantB = await db.productVariant.findFirstOrThrow({
    where: { productId: b.id },
  });
  const input = {
    variantId: variantA.id,
    budgetCode: (await dailyConfig()).policy.budgets[0].code,
    description: "",
    tags: [],
    premium: 0,
    cost: 0,
    capacity: 10,
    active: true,
  };
  await markDaily(a.id);
  await markDaily(b.id);
  const offering = await saveDailyOffering(actor, {
    ...input,
    name: "Tên giả mạo",
  });
  assert.equal(offering.name, a.name);
  const changed = await saveDailyOffering(
    actor,
    { ...input, variantId: variantB.id },
    offering.id,
  );
  assert.equal(changed.name, b.name);
  assert.equal(changed.variantId, variantB.id);
  await db.dailyOffering.update({
    where: { id: offering.id },
    data: { name: "Tên cũ trước cập nhật" },
  });
  assert.equal(
    (await dailyOfferings(db, true)).find((o) => o.id === offering.id)?.name,
    b.name,
  );
});

test("editing a product adds, hides and restores Daily without duplicates or lost settings", async () => {
  const input = product("daily-edit", "Vừa xinh");
  const p = await saveCatalogProduct(actor, undefined, input);
  const variants = await db.productVariant.findMany({
    where: { productId: p.id },
  });
  const saved = { ...input, variants };
  const state = async () =>
    (await listCatalogProducts(actor)).find((row) => row.id === p.id)!;
  assert.equal((await state()).daily, false);
  await saveCatalogProduct(actor, p.id, {
    ...saved,
    categories: [key("category"), DAILY_CATEGORY],
  });
  const offering = await db.dailyOffering.findFirstOrThrow({
    where: { variantId: variants[0].id },
  });
  assert.equal((await state()).daily, true);
  assert.equal((await state()).dailyConfigured, true);
  await db.dailyOffering.update({
    where: { id: offering.id },
    data: { premium: 15000, capacity: 7 },
  });
  await saveCatalogProduct(actor, p.id, {
    ...saved,
    categories: [key("category")],
  });
  assert.equal((await state()).daily, false);
  assert.equal((await state()).dailyConfigured, true);
  assert.equal(
    (await db.dailyOffering.findUniqueOrThrow({ where: { id: offering.id } }))
      .active,
    false,
  );
  await saveCatalogProduct(actor, p.id, {
    ...saved,
    categories: [key("category"), DAILY_CATEGORY],
  });
  const restored = await db.dailyOffering.findUniqueOrThrow({
    where: { id: offering.id },
  });
  assert.equal(restored.active, true);
  assert.equal(restored.premium, 15000);
  assert.equal(restored.capacity, 7);
  await saveCatalogProduct(actor, p.id, {
    ...saved,
    categories: [key("category"), DAILY_CATEGORY],
  });
  assert.equal((await state()).daily, true);
  assert.equal(
    await db.dailyOffering.count({ where: { variantId: variants[0].id } }),
    1,
  );
});

test("editing an existing Daily product preserves its chosen size and individually hidden offerings", async () => {
  const input = product("daily-custom-size");
  const p = await saveCatalogProduct(actor, undefined, input);
  const variants = await db.productVariant.findMany({
    where: { productId: p.id },
  });
  await markDaily(p.id);
  const offering = await saveDailyOffering(actor, {
    variantId: variants[0].id,
    budgetCode: (await dailyConfig()).policy.budgets[0].code,
    description: "",
    tags: [],
    premium: 10000,
    cost: 1000,
    capacity: 5,
    active: true,
  });
  const hiddenSize = await db.productVariant.create({
    data: {
      productId: p.id,
      name: "Daily hidden",
      sku: key("daily-hidden-size"),
      price: 90000,
      stock: 10,
    },
  });
  const hiddenOffering = await saveDailyOffering(actor, {
    variantId: hiddenSize.id,
    budgetCode: offering.budgetCode,
    description: "",
    tags: [],
    premium: 5000,
    cost: 1000,
    capacity: 4,
    active: false,
  });
  await saveCatalogProduct(actor, p.id, {
    ...input,
    variants,
    categories: [key("category"), DAILY_CATEGORY],
  });
  assert.equal(
    (await db.dailyOffering.findUniqueOrThrow({ where: { id: offering.id } }))
      .variantId,
    variants[0].id,
  );
  assert.equal(
    await db.productVariant.count({ where: { productId: p.id } }),
    2,
  );
  assert.equal(
    (
      await db.dailyOffering.findUniqueOrThrow({
        where: { id: hiddenOffering.id },
      })
    ).active,
    false,
  );
});

test("products retain multiple categories, occasions and colors and follow renamed secondary classifications", async () => {
  const input = {
    ...product("multi-classification", "Vừa xinh"),
    categories: [key("category"), DAILY_CATEGORY],
    occasions: [key("occasion"), key("anniversary")],
    colors: [key("color"), key("white")],
  };
  const p = await saveCatalogProduct(actor, undefined, input);
  const row = (await listCatalogProducts(actor)).find((r) => r.id === p.id)!;
  assert.deepEqual(new Set(row.categories), new Set(input.categories));
  assert.deepEqual(new Set(row.occasions), new Set(input.occasions));
  assert.deepEqual(new Set(row.colors), new Set(input.colors));
  assert.equal(
    await db.productTaxonomy.count({ where: { productId: p.id } }),
    6,
  );
  assert.equal(row.daily, true);
  const secondary = await db.taxonomy.findFirstOrThrow({
    where: { kind: "COLOR", name: key("white") },
  });
  await saveCatalogTaxonomy(actor, secondary.id, {
    kind: "COLOR",
    name: key("ivory"),
    slug: secondary.slug,
  });
  assert(
    (await listCatalogProducts(actor))
      .find((r) => r.id === p.id)!
      .colors.includes(key("ivory")),
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
