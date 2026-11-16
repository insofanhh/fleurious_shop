import "dotenv/config";
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { User, Setting, Prisma } from "@prisma/client";
import { db } from "../src/lib/db";
import {
  getSepayConfig,
  getSepayAdminView,
  saveSepaySettings,
  rotateSepayWebhookKey,
  verifySepayAuthorization,
  sepayQrUrl,
  sepaySettingsSchema,
} from "../src/lib/sepay-settings";
import { getSettings } from "../src/lib/settings";
import {
  getMembershipTiers,
  quoteMembership,
  confirmMembershipInvoice,
  getMembershipInvoice,
} from "../src/lib/membership";
import { receiveSepay } from "../src/lib/commerce";
let owner: User, member: User, backup: Setting | null;
const actor = { id: `sepay-qa-${randomUUID()}`, role: "OWNER" };
before(async () => {
  assert.match(new URL(process.env.DATABASE_URL!).pathname, /_test$/);
  // This suite changes the bank destination: close payment-request fixtures
  // from other suites, including manual requests that intentionally never expire.
  await db.order.updateMany({
    where: {
      paymentMethod: "SEPAY",
      paymentStatus: { in: ["UNPAID", "PENDING"] },
    },
    data: { status: "CANCELLED" },
  });
  backup = await db.setting.findUnique({ where: { key: "sepay_payment" } });
  await db.setting.deleteMany({ where: { key: "sepay_payment" } });
  process.env.SEPAY_BANK = "TESTBANK";
  process.env.SEPAY_ACCOUNT_NUMBER = "ENVACCOUNT";
  process.env.SEPAY_ACCOUNT_NAME = "TEST ONLY";
  process.env.SEPAY_WEBHOOK_KEY = "";
  process.env.SEPAY_API_TOKEN = "";
  owner = await db.user.create({
    data: {
      name: "SePay QA",
      email: `${randomUUID()}@example.test`,
      passwordHash: "test-only",
      role: "OWNER",
      verified: true,
    },
  });
  actor.id = owner.id;
  member = await db.user.create({
    data: {
      name: "SePay member QA",
      email: `${randomUUID()}@example.test`,
      passwordHash: "test-only",
      verified: true,
      memberSince: new Date(),
    },
  });
});
after(async () => {
  const invoices = await db.membershipInvoice.findMany({
    where: { userId: member.id },
  });
  await db.payment.deleteMany({
    where: { membershipInvoiceId: { in: invoices.map((i) => i.id) } },
  });
  await db.membershipEntitlement.deleteMany({ where: { userId: member.id } });
  await db.membershipHistory.deleteMany({ where: { userId: member.id } });
  await db.membershipInvoice.deleteMany({ where: { userId: member.id } });
  await db.notification.deleteMany({ where: { userId: member.id } });
  await db.outbox.deleteMany({ where: { userId: member.id } });
  await db.audit.deleteMany({ where: { actorId: owner.id } });
  await db.user.deleteMany({ where: { id: { in: [owner.id, member.id] } } });
  await db.setting.deleteMany({ where: { key: "sepay_payment" } });
  if (backup)
    await db.setting.create({
      data: { ...backup, value: backup.value as Prisma.InputJsonValue },
    });
  await db.$disconnect();
});
test("SePay keeps environment fallback and generates one persistent encrypted webhook key", async () => {
  assert.equal((await getSepayConfig()).accountNumber, "ENVACCOUNT");
  assert.equal((await getSepayConfig()).configured, false);
  const views = await Promise.all([
    getSepayAdminView(actor),
    getSepayAdminView(actor),
    getSepayAdminView(actor),
  ]);
  assert.match(views[0].webhookKey, /^[a-f0-9]{64}$/);
  assert.ok(views.every((v) => v.webhookKey === views[0].webhookKey));
  assert.equal(
    new URL(views[0].webhookUrl).pathname,
    "/api/payments/sepay/webhook",
  );
  const row = await db.setting.findUniqueOrThrow({
    where: { key: "sepay_payment" },
  });
  assert.equal(JSON.stringify(row.value).includes(views[0].webhookKey), false);
});
test("only owner can view secrets, change bank details or rotate webhook keys", async () => {
  for (const role of ["MANAGER", "ACCOUNTANT", "CUSTOMER"]) {
    const restricted = { ...actor, role };
    await assert.rejects(() => getSepayAdminView(restricted), {
      code: "FORBIDDEN",
    });
    await assert.rejects(() => saveSepaySettings(restricted, {}), {
      code: "FORBIDDEN",
    });
    await assert.rejects(() => rotateSepayWebhookKey(restricted, 1), {
      code: "FORBIDDEN",
    });
  }
});
test("dashboard configuration applies immediately to QR and authorization without exposing secrets in shop settings", async () => {
  const previous = await getSepayAdminView(actor);
  const saved = await saveSepaySettings(actor, {
    ...previous,
    bank: "VCB",
    accountNumber: "CONFIGACCOUNT",
    accountName: "CONFIG TEST ONLY",
    apiToken: "private-test-api-token",
  });
  assert.equal(saved.webhookKey, previous.webhookKey);
  assert.equal(saved.version, previous.version + 1);
  const config = await getSepayConfig();
  assert.equal(config.accountNumber, "CONFIGACCOUNT");
  const qr = new URL(sepayQrUrl(config, 123000, "FLR123456789ABC")!);
  assert.equal(qr.searchParams.get("acc"), "CONFIGACCOUNT");
  assert.equal(qr.searchParams.get("bank"), "VCB");
  assert.equal(qr.searchParams.get("amount"), "123000");
  await verifySepayAuthorization(`Apikey ${saved.webhookKey}`);
  await assert.rejects(() => verifySepayAuthorization("Apikey wrong"), {
    code: "UNAUTHORIZED",
  });
  const raw = JSON.stringify(
    (await db.setting.findUniqueOrThrow({ where: { key: "sepay_payment" } }))
      .value,
  );
  assert.equal(raw.includes("private-test-api-token"), false);
  const publicSettings = JSON.stringify(await getSettings());
  assert.equal(publicSettings.includes(saved.webhookKey), false);
  assert.equal(publicSettings.includes("private-test-api-token"), false);
  const audit = JSON.stringify(
    await db.audit.findMany({ where: { actorId: actor.id } }),
  );
  assert.equal(audit.includes(saved.webhookKey), false);
  assert.equal(audit.includes("private-test-api-token"), false);
  await assert.rejects(
    () =>
      saveSepaySettings(actor, {
        ...previous,
        bank: "VCB",
        accountNumber: "OLD",
        accountName: "OLD",
      }),
    { code: "CONFLICT" },
  );
});
test("bank settings validate required fields and reject invalid account characters", () => {
  const base = {
    version: 1,
    enabled: true,
    bank: "VCB",
    accountNumber: "00123",
    accountName: "QA",
  };
  assert.equal(sepaySettingsSchema.safeParse(base).success, true);
  assert.equal(
    sepaySettingsSchema.safeParse({ ...base, bank: "" }).success,
    false,
  );
  assert.equal(
    sepaySettingsSchema.safeParse({ ...base, accountNumber: "123 456" })
      .success,
    false,
  );
  assert.equal(
    sepaySettingsSchema.safeParse({ ...base, accountName: "" }).success,
    false,
  );
  assert.equal(
    sepaySettingsSchema.safeParse({
      ...base,
      enabled: false,
      bank: "",
      accountNumber: "",
      accountName: "",
    }).success,
    true,
  );
});
test("unlimited manual requests block bank changes even after the old reservation deadline", async () => {
  const order = await db.order.create({
    data: {
      code: `FLR${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`,
      idempotencyKey: randomUUID(),
      source: "ZALO",
      createdBy: owner.id,
      buyerName: "QA",
      buyerEmail: "qa@example.test",
      recipientName: "QA",
      recipientPhone: "0901234567",
      address: "QA Hà Nội",
      zoneId: "qa",
      slotId: "qa",
      slotLabel: "QA",
      deliveryDay: "2099-01-01",
      cardMessage: "",
      note: "",
      subtotal: 100000,
      deliveryFee: 0,
      total: 100000,
      paymentMethod: "SEPAY",
      manualPayment: true,
      paymentDueAt: null,
      expiresAt: new Date(0),
    },
  });
  try {
    const previous = await getSepayAdminView(actor);
    await assert.rejects(
      () =>
        saveSepaySettings(actor, { ...previous, accountNumber: "DIFFERENT" }),
      { code: "PAYMENTS_PENDING" },
    );
  } finally {
    await db.order.delete({ where: { id: order.id } });
  }
});

test("membership QR and incoming payments use dashboard bank settings; pending requests block destination changes", async () => {
  const tiers = await getMembershipTiers();
  const tier = tiers.find((t) => t.code === "Bloom")!;
  const id = await quoteMembership(member.id, {
    tierId: tier.id,
    cycle: "MONTH",
    idempotencyKey: randomUUID(),
  });
  await confirmMembershipInvoice(member.id, id, true);
  const invoice = await getMembershipInvoice(id);
  assert.equal(invoice.accountNumber, "CONFIGACCOUNT");
  assert.equal(
    new URL(invoice.paymentQr!).searchParams.get("acc"),
    "CONFIGACCOUNT",
  );
  const config = await getSepayAdminView(actor);
  await assert.rejects(
    () => saveSepaySettings(actor, { ...config, accountNumber: "DIFFERENT" }),
    { code: "PAYMENTS_PENDING" },
  );
  await assert.rejects(
    () => saveSepaySettings(actor, { ...config, enabled: false }),
    { code: "PAYMENTS_PENDING" },
  );
  const payment = {
    id: randomUUID(),
    accountNumber: "CONFIGACCOUNT",
    transferType: "in" as const,
    transferAmount: invoice.amount,
    content: invoice.code,
  };
  await assert.rejects(
    () => receiveSepay({ ...payment, accountNumber: "ENVACCOUNT" }),
    { code: "ACCOUNT_MISMATCH" },
  );
  assert.equal((await receiveSepay(payment)).matched, true);
  assert.equal((await receiveSepay(payment)).duplicate, true);
  assert.equal((await getMembershipInvoice(id)).status, "PAID");
});
test("rotation invalidates old webhook authorization and disable removes new payment QR", async () => {
  const old = await getSepayAdminView(actor);
  const next = await rotateSepayWebhookKey(actor, old.version);
  assert.notEqual(next.webhookKey, old.webhookKey);
  await assert.rejects(
    () => verifySepayAuthorization(`Apikey ${old.webhookKey}`),
    { code: "UNAUTHORIZED" },
  );
  await verifySepayAuthorization(`Apikey ${next.webhookKey}`);
  await assert.rejects(() => rotateSepayWebhookKey(actor, old.version), {
    code: "CONFLICT",
  });
  await saveSepaySettings(actor, { ...next, enabled: false });
  const disabled = await getSepayConfig();
  assert.equal(disabled.configured, false);
  assert.equal(sepayQrUrl(disabled, 1000, "QR"), undefined);
  await assert.rejects(
    () => verifySepayAuthorization(`Apikey ${next.webhookKey}`),
    { code: "NOT_CONFIGURED" },
  );
});
