import { createHash } from "node:crypto";
import { hash as passwordHash } from "bcryptjs";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { z } from "zod";
import { db } from "./db";
import { atomic } from "./transaction";
import { encrypt, decrypt, token, hash, equal } from "./security";
import { fail } from "./errors";
import { verifyMfa } from "./mfa";
import { safeAuthNext } from "./auth-redirect";

export const GOOGLE_COOKIE = "fleurious_google_login";
const keys = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
);
export function googleAuthAvailable() {
  return !!(
    process.env.GOOGLE_CLIENT_ID?.trim() &&
    process.env.GOOGLE_CLIENT_SECRET?.trim()
  );
}
function config() {
  if (!googleAuthAvailable())
    fail("GOOGLE_UNAVAILABLE", "Google chưa được cấu hình.", 503);
  return {
    clientId: process.env.GOOGLE_CLIENT_ID!.trim(),
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!.trim(),
    redirectUri: new URL(
      "/api/auth/google/callback",
      process.env.APP_URL ?? "http://localhost:3000",
    ).href,
  };
}
export async function startGoogleLogin(
  next?: string | null,
  linkUserId?: string,
) {
  const cfg = config();
  const state = token(),
    browser = token(),
    verifier = token(),
    nonce = token();
  await db.googleLoginAttempt.create({
    data: {
      id: hash(state),
      browserHash: hash(browser),
      verifierEncrypted: encrypt(verifier),
      nonce,
      nextPath: safeAuthNext(next),
      linkUserId,
      expiresAt: new Date(Date.now() + 10 * 60000),
    },
  });
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    nonce,
    prompt: "select_account",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  }).toString();
  return { url: url.href, browser, state };
}

const identitySchema = z.object({
  sub: z.string().min(1).max(255),
  email: z.email().max(254),
  email_verified: z.literal(true),
  nonce: z.string(),
  name: z.string().optional(),
});
async function googleIdentity(code: string, verifier: string, nonce: string) {
  const cfg = config();
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: cfg.redirectUri,
      grant_type: "authorization_code",
      code_verifier: verifier,
    }),
    redirect: "error",
    signal: AbortSignal.timeout(10000),
    cache: "no-store",
  });
  if (!response.ok) fail("GOOGLE_FAILED", "Không thể xác minh Google.", 401);
  const result = z
    .object({ id_token: z.string().max(16000) })
    .parse(await response.json());
  const { payload } = await jwtVerify(result.id_token, keys, {
    audience: cfg.clientId,
    issuer: ["https://accounts.google.com", "accounts.google.com"],
    algorithms: ["RS256"],
    requiredClaims: ["sub", "exp", "iat", "nonce"],
    maxTokenAge: "10m",
    clockTolerance: 30,
  });
  const identity = identitySchema.parse(payload);
  if (!equal(identity.nonce, nonce))
    fail("GOOGLE_FAILED", "Không thể xác minh Google.", 401);
  return identity;
}

export async function completeGoogleLogin(input: {
  state: string;
  browser: string;
  code?: string;
  error?: string;
  currentUserId?: string;
}) {
  config();
  const attempt = await db.googleLoginAttempt.findUnique({
    where: { id: hash(input.state) },
  });
  if (
    !attempt ||
    attempt.status !== "PENDING" ||
    attempt.expiresAt <= new Date() ||
    !equal(attempt.browserHash, hash(input.browser))
  )
    fail("GOOGLE_EXPIRED", "Phiên đăng nhập đã hết hạn.", 401);
  const locked = await db.googleLoginAttempt.updateMany({
    where: { id: attempt.id, status: "PENDING", expiresAt: { gt: new Date() } },
    data: { status: "EXCHANGING" },
  });
  if (!locked.count)
    fail("GOOGLE_EXPIRED", "Phiên đăng nhập đã được dùng.", 401);
  if (input.error)
    fail("GOOGLE_CANCELLED", "Bạn đã hủy đăng nhập Google.", 401);
  if (!input.code || input.code.length > 4000)
    fail("GOOGLE_FAILED", "Thiếu mã đăng nhập Google.", 401);
  const identity = await googleIdentity(
    input.code,
    decrypt(attempt.verifierEncrypted),
    attempt.nonce,
  );
  const email = identity.email.toLowerCase();
  const user = await atomic(async (tx) => {
    let found = await tx.user.findUnique({
      where: { googleSubject: identity.sub },
    });
    if (attempt.linkUserId) {
      if (attempt.linkUserId !== input.currentUserId)
        fail("GOOGLE_LINK_MISMATCH", "Phiên liên kết đã thay đổi.", 401);
      const target = await tx.user.findUniqueOrThrow({
        where: { id: attempt.linkUserId },
      });
      if (target.disabled) fail("GOOGLE_BLOCKED", "Tài khoản đã bị khóa.", 403);
      if (
        target.email.toLowerCase() !== email ||
        (found && found.id !== target.id) ||
        (target.googleSubject && target.googleSubject !== identity.sub)
      )
        fail("GOOGLE_LINK_MISMATCH", "Tài khoản Google không khớp.", 409);
      found = await tx.user.update({
        where: { id: target.id },
        data: { googleSubject: identity.sub },
      });
      await tx.audit.create({
        data: {
          actorId: target.id,
          action: "auth.google_linked",
          entityId: target.id,
          detail: {},
        },
      });
    } else if (!found) {
      if (await tx.user.findUnique({ where: { email } }))
        fail(
          "GOOGLE_ACCOUNT_EXISTS",
          "Email đã có tài khoản, cần liên kết từ Hồ sơ.",
          409,
        );
      found = await tx.user.create({
        data: {
          email,
          googleSubject: identity.sub,
          verified: true,
          name: (identity.name?.trim() || email.split("@")[0]).slice(0, 100),
          passwordHash: await passwordHash(token(), 12),
        },
      });
      await tx.outbox.create({
        data: { userId: found.id, event: "user.registered", payload: {} },
      });
    }
    if (found.disabled) fail("GOOGLE_BLOCKED", "Tài khoản đã bị khóa.", 403);
    await tx.googleLoginAttempt.update({
      where: { id: attempt.id },
      data: {
        status: found.totpEnabled ? "MFA_PENDING" : "COMPLETE",
        userId: found.id,
        verifierEncrypted: "",
        nonce: "",
        expiresAt: new Date(Date.now() + 5 * 60000),
      },
    });
    return found;
  });
  return { user, nextPath: attempt.nextPath, needsMfa: user.totpEnabled };
}

export async function completeGoogleMfa(
  state: string,
  browser: string,
  code: string,
) {
  const attempt = await db.googleLoginAttempt.findUnique({
    where: { id: hash(state) },
  });
  if (
    !attempt?.userId ||
    attempt.status !== "MFA_PENDING" ||
    attempt.expiresAt <= new Date() ||
    !equal(attempt.browserHash, hash(browser))
  )
    fail("GOOGLE_EXPIRED", "Phiên xác thực đã hết hạn.", 401);
  const user = await db.user.findUniqueOrThrow({
    where: { id: attempt.userId },
  });
  if (user.disabled) fail("GOOGLE_BLOCKED", "Tài khoản đã bị khóa.", 403);
  if (!(await verifyMfa(user.id, code)))
    fail("MFA_INVALID", "Mã 2FA chưa đúng, đã dùng hoặc hết hạn.", 401);
  const session = token();
  await atomic(async (tx) => {
    const updated = await tx.googleLoginAttempt.updateMany({
      where: {
        id: attempt.id,
        status: "MFA_PENDING",
        expiresAt: { gt: new Date() },
      },
      data: { status: "COMPLETE" },
    });
    if (!updated.count)
      fail("GOOGLE_EXPIRED", "Phiên xác thực đã được dùng.", 401);
    const fresh = await tx.user.findUniqueOrThrow({ where: { id: user.id } });
    if (fresh.disabled || !fresh.totpEnabled)
      fail(
        "GOOGLE_EXPIRED",
        "Tài khoản đã thay đổi. Vui lòng đăng nhập lại.",
        401,
      );
    await tx.session.create({
      data: {
        id: hash(session),
        userId: user.id,
        expiresAt: new Date(Date.now() + 30 * 86400000),
      },
    });
  });
  return { session, nextPath: attempt.nextPath };
}
