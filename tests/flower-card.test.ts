import "dotenv/config";
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import jsQR from "jsqr";
import {
  cardTemplatePng,
  renderCardTemplate,
  flowerCardPng,
  renderFlowerCard,
  type FlowerCard,
  CARD,
} from "../src/lib/flower-card";
import { CARD_SIZES, CARD_DPI } from "../src/lib/card-design";
import { getOrderCard } from "../src/lib/order-card";
import { customerOrder } from "../src/lib/order-privacy";
import { db } from "../src/lib/db";
import { encrypt, hash } from "../src/lib/security";
const card: FlowerCard = {
  code: "FLR123456789ABC",
  buyerName: "Minh Anh",
  recipientName: "Ngọc Linh",
  message: "Mong em luôn có những ngày dịu dàng.\nThương em!",
  qrUrl: `https://flowers.example/q/${"a".repeat(64)}`,
};
let orderId: string;
before(async () => {
  assert.match(new URL(process.env.DATABASE_URL!).pathname, /_test$/);
  const order = await db.order.create({
    data: {
      code: `QA${randomUUID()}`,
      idempotencyKey: randomUUID(),
      buyerName: card.buyerName,
      buyerEmail: "qa@example.test",
      recipientName: card.recipientName,
      recipientPhone: "0000000000",
      address: "TEST ONLY",
      zoneId: "test",
      deliveryDay: "2026-11-15",
      slotId: "test",
      slotLabel: "Test",
      cardMessage: card.message,
      note: "Test",
      paymentMethod: "COD",
      subtotal: 100000,
      deliveryFee: 0,
      total: 100000,
      expiresAt: new Date(Date.now() + 60000),
      qr: {
        create: {
          tokenHash: hash(randomUUID()),
          tokenEncrypted: encrypt("a".repeat(64)),
        },
      },
    },
  });
  orderId = order.id;
});
after(async () => {
  await db.qrGrant.deleteMany({ where: { orderId } });
  await db.order.delete({ where: { id: orderId } });
  await db.$disconnect();
});
test("customer order serialization removes QR claim tokens and internal identifiers", () => {
  const value = customerOrder({
    code: "FLR",
    guestHash: "secret",
    idempotencyKey: "private",
    createdBy: "private-staff-id",
    qr: { url: card.qrUrl, tokenEncrypted: "secret" },
  });
  assert.deepEqual(value, { code: "FLR" });
});
test("landscape QR PNG retains its physical density and decodes to the unchanged claim URL", async () => {
  const png = await flowerCardPng(card, "back"),
    meta = await sharp(png).metadata();
  assert.equal(
    meta.width,
    Math.round((CARD_SIZES.back.width / 25.4) * CARD_DPI),
  );
  assert.equal(
    meta.height,
    Math.round((CARD_SIZES.back.height / 25.4) * CARD_DPI),
  );
  assert.equal(meta.density, CARD_DPI);
  const { data, info } = await sharp(png)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const code = jsQR(new Uint8ClampedArray(data), info.width, info.height);
  assert.equal(code?.data, card.qrUrl);
});
test("blank stationery and brand cards export independent image sizes", async () => {
  for (const kind of ["blank", "brand"] as const) {
    const meta = await sharp(await cardTemplatePng(kind)).metadata();
    assert.equal(
      meta.width,
      Math.round((CARD_SIZES[kind].width / 25.4) * CARD_DPI),
    );
    assert.equal(
      meta.height,
      Math.round((CARD_SIZES[kind].height / 25.4) * CARD_DPI),
    );
    assert.equal(meta.density, CARD_DPI);
    assert.ok((await renderCardTemplate(kind)).includes("<path"));
  }
});
test("handwritten orders leave the message area empty while retaining sender and recipient", async () => {
  const manual = { ...card, writingMode: "HANDWRITTEN" as const };
  const svg = await renderFlowerCard(manual, "front");
  assert.equal(
    svg,
    await renderFlowerCard(
      { ...manual, message: "Nội dung khác không được in lên ảnh" },
      "front",
    ),
  );
  assert.notEqual(
    svg,
    await renderFlowerCard(
      { ...manual, buyerName: "Tên người gửi khác" },
      "front",
    ),
  );
  assert.notEqual(
    svg,
    await renderFlowerCard(
      { ...manual, recipientName: "Tên người nhận khác" },
      "front",
    ),
  );
  const scale = CARD_DPI / 25.4;
  const body = await sharp(await flowerCardPng(manual, "front"))
    .extract({
      left: Math.ceil(9 * scale),
      top: Math.ceil(46 * scale),
      width: Math.floor(56 * scale),
      height: Math.floor(35 * scale),
    })
    .removeAlpha()
    .raw()
    .toBuffer();
  for (let i = 0; i < body.length; i += 3) {
    assert.equal(body[i], 244);
    assert.equal(body[i + 1], 234);
    assert.equal(body[i + 2], 222);
  }
  assert.notEqual(
    await renderFlowerCard({ ...card, writingMode: "AUTO" }, "front"),
    await renderFlowerCard(
      { ...card, message: "Lời chúc khác", writingMode: "AUTO" },
      "front",
    ),
  );
});
test("landscape QR artwork does not print order codes or personal details", async () => {
  const original = await renderFlowerCard(card, "back");
  const changed = await renderFlowerCard(
    {
      ...card,
      code: "DIFFERENT-ORDER",
      buyerName: "Người gửi khác",
      recipientName: "Người nhận khác",
      message: "Lời nhắn khác",
    },
    "back",
  );
  assert.equal(original, changed);
  assert.match(original, /width="90mm" height="50mm"/);
});
test("card safely outlines Vietnamese and untrusted text, including long messages", async () => {
  const svg = await renderFlowerCard(
    {
      ...card,
      message:
        "Chúc em một ngày thật đẹp!\n".repeat(20).slice(0, 500) +
        "<script>alert(1)</script>",
    },
    "front",
  );
  assert.equal(svg.includes("<script>"), false);
  assert.equal(svg.includes("NaN"), false);
  assert.equal(svg.includes("Infinity"), false);
  assert.ok(svg.includes("<path"));
});
test("only packing staff can obtain the card; pending orders can be printed without activating a day", async () => {
  for (const role of ["CUSTOMER", "DELIVERY", "ACCOUNTANT", "MARKETING"])
    await assert.rejects(() => getOrderCard({ id: "qa", role }, orderId), {
      code: "FORBIDDEN",
    });
  for (const role of ["OWNER", "MANAGER", "FLORIST"]) {
    const result = await getOrderCard({ id: "qa", role }, orderId);
    assert.equal(result.state, "PENDING");
    assert.equal(result.printable, true);
  }
  const grant = await db.qrGrant.findUniqueOrThrow({ where: { orderId } });
  assert.equal(grant.claimsCount, 0);
  assert.equal(grant.eligibleAt, null);
});
test("packing metadata follows the stored writing mode without printing the handwriting request", async () => {
  await db.order.update({
    where: { id: orderId },
    data: {
      cardWritingMode: "HANDWRITTEN",
      cardMessage: "Lời chúc cần viết tay. ".repeat(20),
    },
  });
  const result = await getOrderCard({ id: "qa", role: "OWNER" }, orderId);
  assert.equal(result.writingMode, "HANDWRITTEN");
  assert.equal(result.card.writingMode, "HANDWRITTEN");
  assert.equal(result.longMessage, false);
  assert.equal(
    await renderFlowerCard(result.card, "front"),
    await renderFlowerCard({ ...result.card, message: "" }, "front"),
  );
});
test("revoked, expired and exhausted QR grants cannot be printed", async () => {
  const actor = { id: "qa", role: "OWNER" };
  await db.qrGrant.update({ where: { orderId }, data: { revoked: true } });
  assert.equal((await getOrderCard(actor, orderId)).printable, false);
  await db.qrGrant.update({
    where: { orderId },
    data: { revoked: false, expiresAt: new Date(Date.now() - 1000) },
  });
  assert.equal((await getOrderCard(actor, orderId)).state, "EXPIRED");
  await db.qrGrant.update({
    where: { orderId },
    data: { expiresAt: null, claimsCount: 1 },
  });
  assert.equal((await getOrderCard(actor, orderId)).state, "EXHAUSTED");
});
