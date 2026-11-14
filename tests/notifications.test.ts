import "dotenv/config";
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../src/lib/db";
import {
  notifyStaff,
  notificationScope,
  projectStaffNotification,
} from "../src/lib/notifications";
import { streakQrPath } from "../src/lib/qr-link";
import type { User } from "@prisma/client";
const run = `notice-test-${randomUUID()}`;
const users: User[] = [];
let owner: User, florist: User, marketing: User, customer: User, disabled: User;
before(async () => {
  assert.match(new URL(process.env.DATABASE_URL!).pathname, /_test$/);
  for (const [role, off] of [
    ["OWNER", false],
    ["FLORIST", false],
    ["MARKETING", false],
    ["CUSTOMER", false],
    ["OWNER", true],
  ] as const) {
    users.push(
      await db.user.create({
        data: {
          name: "Notification QA",
          email: `${randomUUID()}@example.test`,
          passwordHash: "test-only",
          role,
          disabled: off,
        },
      }),
    );
  }
  [owner, florist, marketing, customer, disabled] = users;
});
after(async () => {
  await db.outbox.deleteMany({
    where: {
      OR: [
        { userId: { in: users.map((u) => u.id) } },
        { payload: { path: "$.key", string_contains: run } },
      ],
    },
  });
  await db.notification.deleteMany({
    where: {
      OR: [
        { userId: { in: users.map((u) => u.id) } },
        { dedupKey: { contains: run } },
      ],
    },
  });
  await db.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
  await db.$disconnect();
});
test("staff alerts follow role permissions, skip disabled accounts and deduplicate concurrent delivery", async () => {
  await Promise.all(
    [1, 2, 3].map(() =>
      notifyStaff(`${run}-order`, "orders", "New order", "QA", "/admin/orders"),
    ),
  );
  for (const [user, count] of [
    [owner, 1],
    [florist, 1],
    [marketing, 0],
    [customer, 0],
    [disabled, 0],
  ] as const) {
    assert.equal(
      await db.notification.count({
        where: { userId: user.id, dedupKey: { contains: `${run}-order` } },
      }),
      count,
    );
    assert.equal(
      await db.outbox.count({
        where: { userId: user.id, event: "notification.created" },
      }),
      count,
    );
  }
});
test("customer and admin inboxes remain separate; downgrade removes restricted old alerts", async () => {
  await notifyStaff(
    `${run}-payment`,
    "payments",
    "Payment review",
    "QA",
    "/admin/payments",
  );
  await db.notification.create({
    data: { userId: owner.id, title: "Personal", body: "QA", url: "/account" },
  });
  assert.equal(
    await db.notification.count({
      where: notificationScope(owner.id, "OWNER", false),
    }),
    1,
  );
  assert.equal(
    await db.notification.count({
      where: notificationScope(owner.id, "OWNER", true),
    }),
    2,
  );
  assert.equal(
    await db.notification.count({
      where: notificationScope(owner.id, "FLORIST", true),
    }),
    1,
  );
  assert.equal(
    await db.notification.count({
      where: notificationScope(customer.id, "CUSTOMER", true),
    }),
    0,
  );
  await db.notification.updateMany({
    where: notificationScope(customer.id, "CUSTOMER", false),
    data: { read: true },
  });
  assert.equal(
    await db.notification.count({
      where: { ...notificationScope(owner.id, "OWNER", true), read: true },
    }),
    0,
  );
});
test("new customer events produce a durable staff notification once", async () => {
  const event = {
    id: `${run}-signup`,
    event: "user.registered",
    userId: customer.id,
    payload: {},
    sent: false,
    attempts: 0,
    leasedUntil: null,
    createdAt: new Date(),
  };
  await projectStaffNotification(event);
  await projectStaffNotification(event);
  assert.equal(
    await db.notification.count({
      where: { userId: owner.id, dedupKey: { contains: event.id } },
    }),
    1,
  );
  assert.equal(
    await db.notification.count({
      where: { userId: florist.id, dedupKey: { contains: event.id } },
    }),
    0,
  );
});
test("QR scanner keeps the existing claim link and refuses external, payment or invalid links", () => {
  const origin = "https://fleurious.example",
    path = `/q/${"a".repeat(64)}`;
  assert.equal(streakQrPath(`${origin}${path}`, origin), path);
  assert.equal(streakQrPath(path, origin), path);
  assert.equal(streakQrPath(`${origin}${path}?utm_source=qr`, origin), path);
  for (const bad of [
    `https://evil.example${path}`,
    `//evil.example${path}`,
    "javascript:alert(1)",
    "/membership/invoices/123",
    "/q/bad",
    `${origin}/q/${"a".repeat(63)}`,
    `https://user:pass@fleurious.example${path}`,
  ])
    assert.equal(streakQrPath(bad, origin), null);
});
