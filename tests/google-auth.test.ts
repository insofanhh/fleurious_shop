import "dotenv/config";
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { db } from "../src/lib/db";
import { hash, encrypt, decrypt, token } from "../src/lib/security";
import { safeAuthNext } from "../src/lib/auth-redirect";
import {
  startGoogleLogin,
  completeGoogleLogin,
  completeGoogleMfa,
  googleAuthAvailable,
} from "../src/lib/google-auth";
import { setupMfa, recoveryCodes } from "../src/lib/mfa";
import { claimQr } from "../src/lib/commerce";
import { dayKey } from "../src/lib/time";
import { defaultSettings } from "../src/lib/settings";

const run = `google-${randomUUID()}`;
const originalFetch = globalThis.fetch;
const previousEnv = {
  id: process.env.GOOGLE_CLIENT_ID,
  secret: process.env.GOOGLE_CLIENT_SECRET,
};
const codes = new Map<
  string,
  { nonce: string; verifier: string; claims: Record<string, unknown> }
>();
const attempts: string[] = [];
const users = new Set<string>();
const orders: string[] = [];
let key: Awaited<ReturnType<typeof generateKeyPair>>;
let settings: Awaited<ReturnType<typeof db.setting.findUnique>>;
before(async () => {
  assert.match(new URL(process.env.DATABASE_URL!).pathname, /_test$/);
  process.env.GOOGLE_CLIENT_ID = "google-test.apps.googleusercontent.com";
  process.env.GOOGLE_CLIENT_SECRET = "test-only-google-secret";
  key = await generateKeyPair("RS256");
  const jwk = {
    ...(await exportJWK(key.publicKey)),
    kid: "google-test",
    alg: "RS256",
    use: "sig",
  };
  globalThis.fetch = async (input, options) => {
    const url = String(input);
    if (url === "https://www.googleapis.com/oauth2/v3/certs")
      return Response.json({ keys: [jwk] });
    if (url === "https://oauth2.googleapis.com/token") {
      const form = new URLSearchParams(String(options?.body));
      const code = codes.get(form.get("code") ?? "");
      if (!code || code.verifier !== form.get("code_verifier"))
        return Response.json({ error: "invalid_grant" }, { status: 400 });
      assert.equal(form.get("client_secret"), process.env.GOOGLE_CLIENT_SECRET);
      const jwt = await new SignJWT({
        sub: `${run}-new`,
        email: `${run}@example.test`,
        email_verified: true,
        nonce: code.nonce,
        name: "Google QA",
        ...code.claims,
      })
        .setProtectedHeader({ alg: "RS256", kid: "google-test" })
        .setIssuer("https://accounts.google.com")
        .setAudience(String(code.claims.aud ?? process.env.GOOGLE_CLIENT_ID))
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(key.privateKey);
      return Response.json({
        id_token: jwt,
        access_token: "discarded",
        token_type: "Bearer",
      });
    }
    throw new Error(`Unexpected external request in OAuth test: ${url}`);
  };
  settings = await db.setting.findUnique({ where: { key: "shop" } });
  await db.setting.upsert({
    where: { key: "shop" },
    create: { key: "shop", value: defaultSettings },
    update: { value: defaultSettings },
  });
});
after(async () => {
  globalThis.fetch = originalFetch;
  if (previousEnv.id === undefined) delete process.env.GOOGLE_CLIENT_ID;
  else process.env.GOOGLE_CLIENT_ID = previousEnv.id;
  if (previousEnv.secret === undefined) delete process.env.GOOGLE_CLIENT_SECRET;
  else process.env.GOOGLE_CLIENT_SECRET = previousEnv.secret;
  for (const user of await db.user.findMany({
    where: { googleSubject: { startsWith: run } },
    select: { id: true },
  }))
    users.add(user.id);
  const ids = [...users];
  await db.qrClaim.deleteMany({ where: { userId: { in: ids } } });
  await db.activeDay.deleteMany({ where: { userId: { in: ids } } });
  await db.reward.deleteMany({ where: { userId: { in: ids } } });
  await db.outbox.deleteMany({ where: { userId: { in: ids } } });
  await db.notification.deleteMany({ where: { userId: { in: ids } } });
  await db.audit.deleteMany({ where: { actorId: { in: ids } } });
  await db.googleLoginAttempt.deleteMany({ where: { id: { in: attempts } } });
  await db.qrGrant.deleteMany({ where: { orderId: { in: orders } } });
  await db.orderItem.deleteMany({ where: { orderId: { in: orders } } });
  await db.order.deleteMany({ where: { id: { in: orders } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  if (settings)
    await db.setting.update({
      where: { key: "shop" },
      data: { value: settings.value! },
    });
  await db.$disconnect();
});
async function begin(
  claims: Record<string, unknown> = {},
  next = "/streak",
  linkUserId?: string,
) {
  const login = await startGoogleLogin(next, linkUserId);
  attempts.push(hash(login.state));
  const record = await db.googleLoginAttempt.findUniqueOrThrow({
    where: { id: hash(login.state) },
  });
  const code = randomUUID();
  codes.set(code, {
    nonce: record.nonce,
    verifier: decrypt(record.verifierEncrypted),
    claims,
  });
  return { ...login, code };
}
test("Google stays unavailable until both server-only credentials exist", async () => {
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.GOOGLE_CLIENT_SECRET;
  assert.equal(googleAuthAvailable(), false);
  await assert.rejects(() => startGoogleLogin(), {
    code: "GOOGLE_UNAVAILABLE",
  });
  process.env.GOOGLE_CLIENT_SECRET = secret;
});
test("OAuth uses state, nonce, PKCE and preserves the exact QR return path", async () => {
  const next = `/q/${token()}`;
  const start = await begin({}, next);
  const url = new URL(start.url);
  assert.equal(url.origin, "https://accounts.google.com");
  assert.equal(url.searchParams.get("state"), start.state);
  assert.equal(url.searchParams.get("scope"), "openid email profile");
  const row = await db.googleLoginAttempt.findUniqueOrThrow({
    where: { id: hash(start.state) },
  });
  assert.equal(row.nextPath, next);
  assert.equal(row.browserHash, hash(start.browser));
  assert.equal(
    url.searchParams.get("code_challenge"),
    createHash("sha256")
      .update(decrypt(row.verifierEncrypted))
      .digest("base64url"),
  );
  assert.ok(!row.verifierEncrypted.includes(decrypt(row.verifierEncrypted)));
  for (const unsafe of [
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "/\n/evil.example",
    "/api/admin/orders",
    "/auth/login",
  ])
    assert.equal(safeAuthNext(unsafe), "/account");
});
test("state is browser-bound, expiring and single-use; cancellation retains no identity", async () => {
  const flow = await begin();
  await assert.rejects(
    () => completeGoogleLogin({ ...flow, browser: token() }),
    { code: "GOOGLE_EXPIRED" },
  );
  await db.googleLoginAttempt.update({
    where: { id: hash(flow.state) },
    data: { expiresAt: new Date(Date.now() - 1) },
  });
  await assert.rejects(() => completeGoogleLogin(flow), {
    code: "GOOGLE_EXPIRED",
  });
  const cancelled = await begin();
  await assert.rejects(
    () => completeGoogleLogin({ ...cancelled, error: "access_denied" }),
    { code: "GOOGLE_CANCELLED" },
  );
  await assert.rejects(() => completeGoogleLogin(cancelled), {
    code: "GOOGLE_EXPIRED",
  });
});
test("signed tokens with wrong audience, nonce or unverified email cannot create a user", async () => {
  for (const claims of [
    { aud: "another-client" },
    { nonce: "tampered" },
    { email_verified: false },
  ]) {
    const flow = await begin({ sub: `${run}-invalid`, ...claims });
    await assert.rejects(() => completeGoogleLogin(flow));
  }
  assert.equal(
    await db.user.count({ where: { googleSubject: `${run}-invalid` } }),
    0,
  );
});
test("Google login from a QR creates one verified customer and activates only one Hanoi day", async () => {
  const qr = token(),
    next = `/q/${qr}`;
  const flow = await begin({}, next);
  const result = await completeGoogleLogin(flow);
  users.add(result.user.id);
  assert.equal(result.nextPath, next);
  assert.equal(result.user.verified, true);
  assert.equal(result.user.role, "CUSTOMER");
  assert.equal(result.needsMfa, false);
  await assert.rejects(() => completeGoogleLogin(flow), {
    code: "GOOGLE_EXPIRED",
  });
  const order = await db.order.create({
    data: {
      code: `QA${randomUUID()}`,
      idempotencyKey: randomUUID(),
      buyerName: "QA",
      buyerEmail: "qa@example.test",
      recipientName: "QA",
      recipientPhone: "0900000000",
      address: "TEST ONLY",
      zoneId: "test-zone",
      deliveryDay: dayKey(),
      slotId: "test-slot",
      slotLabel: "Test",
      cardMessage: "",
      note: "Test",
      paymentMethod: "COD",
      status: "COMPLETED",
      fulfillment: "DELIVERED",
      paymentStatus: "PAID",
      subtotal: 100000,
      total: 100000,
      deliveryFee: 0,
      expiresAt: new Date(Date.now() + 3600000),
      items: {
        create: {
          variantId: "test",
          name: "Hoa Google QA",
          variantName: "M",
          image: "/images/roses.webp",
          quantity: 1,
          price: 100000,
        },
      },
      qr: {
        create: {
          tokenHash: hash(qr),
          tokenEncrypted: encrypt(qr),
          eligibleAt: new Date(),
          expiresAt: new Date(Date.now() + 3600000),
        },
      },
    },
  });
  orders.push(order.id);
  await claimQr(qr, result.user);
  assert.equal((await claimQr(qr, result.user)).alreadyClaimed, true);
  assert.equal(
    await db.activeDay.count({
      where: { userId: result.user.id, day: dayKey(), valid: true },
    }),
    1,
  );
  assert.equal(
    (await db.qrGrant.findUniqueOrThrow({ where: { orderId: order.id } }))
      .claimsCount,
    1,
  );
  const second = await completeGoogleLogin(await begin());
  assert.equal(second.user.id, result.user.id);
});
test("matching emails never silently link an existing local account", async () => {
  const email = `${run}-existing@example.test`;
  const local = await db.user.create({
    data: {
      email,
      name: "Existing QA",
      passwordHash: "test-only",
      verified: true,
      role: "OWNER",
    },
  });
  users.add(local.id);
  const flow = await begin({ sub: `${run}-linked`, email });
  await assert.rejects(() => completeGoogleLogin(flow), {
    code: "GOOGLE_ACCOUNT_EXISTS",
  });
  assert.equal(
    (await db.user.findUniqueOrThrow({ where: { id: local.id } }))
      .googleSubject,
    null,
  );
  const mismatch = await begin(
    { sub: `${run}-linked`, email },
    "/account/profile",
    local.id,
  );
  await assert.rejects(
    () => completeGoogleLogin({ ...mismatch, currentUserId: "another-user" }),
    { code: "GOOGLE_LINK_MISMATCH" },
  );
  const linked = await completeGoogleLogin({
    ...(await begin(
      { sub: `${run}-linked`, email },
      "/account/profile",
      local.id,
    )),
    currentUserId: local.id,
  });
  assert.equal(linked.user.id, local.id);
  assert.equal(linked.user.role, "OWNER");
});
test("Google cannot bypass account blocking or existing Fleurious 2FA", async () => {
  const mfa = setupMfa("qa@example.test"),
    recovery = recoveryCodes();
  const local = await db.user.create({
    data: {
      email: `${run}-mfa@example.test`,
      name: "MFA QA",
      passwordHash: "test-only",
      verified: true,
      googleSubject: `${run}-mfa`,
      totpEnabled: true,
      totpSecretEncrypted: mfa.encrypted,
      recoveryHashes: recovery.hashes,
    },
  });
  users.add(local.id);
  const flow = await begin(
    { sub: `${run}-mfa`, email: local.email },
    `/q/${token()}`,
  );
  const result = await completeGoogleLogin(flow);
  assert.equal(result.needsMfa, true);
  assert.equal(await db.session.count({ where: { userId: local.id } }), 0);
  await assert.rejects(
    () => completeGoogleMfa(flow.state, flow.browser, "wrong"),
    { code: "MFA_INVALID" },
  );
  await assert.rejects(
    () => completeGoogleMfa(flow.state, token(), recovery.codes[0]),
    { code: "GOOGLE_EXPIRED" },
  );
  const done = await completeGoogleMfa(
    flow.state,
    flow.browser,
    recovery.codes[0],
  );
  assert.equal(done.nextPath, result.nextPath);
  assert.equal(
    await db.session.count({
      where: { userId: local.id, id: hash(done.session) },
    }),
    1,
  );
  await assert.rejects(
    () => completeGoogleMfa(flow.state, flow.browser, recovery.codes[1]),
    { code: "GOOGLE_EXPIRED" },
  );
  await db.user.update({ where: { id: local.id }, data: { disabled: true } });
  await assert.rejects(
    async () =>
      completeGoogleLogin(
        await begin({ sub: `${run}-mfa`, email: local.email }),
      ),
    { code: "GOOGLE_BLOCKED" },
  );
});
